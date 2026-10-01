import {
  APIConnectionError,
  APITimeoutError,
  type ApiErrorBody,
  errorFromStatus,
} from "./errors.js";

// A fetch implementation compatible with the global `fetch`. Used as the base
// transport; defaults to the runtime's global fetch.
export type FetchLike = typeof fetch;

// The shared low-level transport: sends one Request and resolves to its Response,
// applying a timeout and retrying transient failures. Its signature matches what
// openapi-fetch expects for its `fetch` option, so the same instance backs both
// the typed (spec-driven) client and the untyped RawClient.
export type Dispatch = (request: Request) => Promise<Response>;

// Inputs needed to build a Dispatch.
export interface DispatchOptions {
  fetch: FetchLike;
  timeoutMs: number;
  maxRetries: number;
}

// Upper bound applied to a server-provided Retry-After delay, so a hostile or
// buggy header cannot make the client sleep for an unbounded time.
const MAX_RETRY_AFTER_MS = 30_000;

// Builds a Dispatch that wraps a base fetch with a per-attempt timeout and
// exponential-backoff retries on network errors, 429, and 5xx responses. The
// caller's AbortSignal is honored both during a request and during retry backoff.
export function createDispatch(opts: DispatchOptions): Dispatch {
  const { fetch: base, timeoutMs, maxRetries } = opts;
  return async (request: Request): Promise<Response> => {
    const callerSignal = request.signal;
    let attempt = 0;
    // Retry transient failures up to maxRetries; each attempt gets a fresh clone
    // (a Request body can only be read once) and its own timeout controller.
    while (true) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", onAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response | undefined;
      let failure: unknown;
      try {
        response = await base(request.clone(), { signal: controller.signal });
      } catch (err) {
        failure = err;
      } finally {
        clearTimeout(timer);
        callerSignal.removeEventListener("abort", onAbort);
      }

      if (failure !== undefined) {
        // A caller abort is terminal; never retry it.
        if (isCallerAbort(failure, callerSignal)) {
          throw new APIConnectionError("Request aborted by caller", failure);
        }
        if (attempt < maxRetries) {
          await backoffSleep(backoffMs(attempt), callerSignal);
          attempt++;
          continue;
        }
        if (isAbortError(failure)) {
          throw new APITimeoutError("Request timed out", failure);
        }
        throw new APIConnectionError("Request failed to reach the Neev API", failure);
      }

      const ok = response as Response;
      if (!ok.ok && isRetryableStatus(ok.status) && attempt < maxRetries) {
        await backoffSleep(retryDelayMs(ok, attempt), callerSignal);
        attempt++;
        continue;
      }
      return ok;
    }
  };
}

// Configuration for the untyped client.
export interface RawClientOptions {
  baseUrl: string;
  apiKey: string;
  dispatch: Dispatch;
}

// A single untyped request for an endpoint that has no OpenAPI spec yet.
export interface RawRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  // Path relative to the base URL, e.g. "/api/v1beta1/.../widgets".
  path: string;
  // Query parameters; null/undefined entries are omitted.
  query?: Record<string, string | number | undefined | null>;
  // JSON request body, serialized when present.
  body?: unknown;
  // Caller cancellation signal, combined with the per-request timeout.
  signal?: AbortSignal;
}

// Untyped HTTP client for spec-less endpoints. Shares the same Dispatch (and thus
// the same auth, timeout, retry, and error mapping) as the typed client. Callers
// supply the response type parameter and hand-write the wrapper around it.
export class RawClient {
  private readonly opts: RawClientOptions;

  constructor(opts: RawClientOptions) {
    this.opts = opts;
  }

  // Issues the request and returns the parsed JSON body typed as T. An empty body
  // (e.g. 204) resolves to undefined. Throws an APIError on a non-2xx response.
  async request<T>(req: RawRequest): Promise<T> {
    // Concatenate base + path (matching openapi-fetch) so a base URL path prefix
    // is preserved rather than dropped by relative URL resolution.
    const base = this.opts.baseUrl.replace(/\/+$/, "");
    const path = req.path.startsWith("/") ? req.path : `/${req.path}`;
    const url = new URL(`${base}${path}`);
    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.opts.apiKey}`,
      accept: "application/json",
    };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(req.body);
    }

    const request = new Request(url, { method: req.method, headers, body, signal: req.signal });
    const response = await this.opts.dispatch(request);
    const parsed = await parseBody(response);
    if (!response.ok) {
      throw errorFromStatus(response.status, toErrorBody(parsed), requestId(response));
    }
    return parsed as T;
  }
}

// The shape of one openapi-fetch result, narrowed to what unwrap/ensureOk need.
interface FetchResult {
  error?: unknown;
  response: Response;
}

// Returns the typed data from an openapi-fetch result, or throws a typed APIError
// when the response was not 2xx.
export function unwrap<T>(result: FetchResult & { data?: T }): T {
  if (!result.response.ok) {
    throw errorFromStatus(
      result.response.status,
      toErrorBody(result.error),
      requestId(result.response),
    );
  }
  return result.data as T;
}

// Throws a typed APIError when an openapi-fetch result was not 2xx; used for
// no-content responses where there is no data to return.
export function ensureOk(result: FetchResult): void {
  if (!result.response.ok) {
    throw errorFromStatus(
      result.response.status,
      toErrorBody(result.error),
      requestId(result.response),
    );
  }
}

// Reads the body as JSON, returning undefined for an empty body. A non-JSON body
// is surfaced as a details string rather than a fabricated error code.
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { details: text };
  }
}

// Coerces an unknown error payload into the API error body shape when possible.
function toErrorBody(value: unknown): ApiErrorBody | undefined {
  if (
    value &&
    typeof value === "object" &&
    ("message" in value || "code" in value || "error" in value || "details" in value)
  ) {
    return value as ApiErrorBody;
  }
  return undefined;
}

// Extracts the x-request-id response header for support correlation.
function requestId(response: Response): string | undefined {
  return response.headers.get("x-request-id") ?? undefined;
}

// 429 and 5xx are safe to retry; other 4xx are caller errors and are not.
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// True when the failure is the caller's own signal aborting, not the timeout.
function isCallerAbort(err: unknown, signal: AbortSignal): boolean {
  return isAbortError(err) && signal.aborted;
}

// Detects the error raised when an AbortController aborts a fetch.
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// Picks the delay before the next retry. Honors a Retry-After header in either
// delta-seconds or HTTP-date form, clamped to a sane bound; otherwise backs off.
function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return clamp(seconds * 1000, 0, MAX_RETRY_AFTER_MS);
    }
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
      return clamp(dateMs - Date.now(), 0, MAX_RETRY_AFTER_MS);
    }
  }
  return backoffMs(attempt);
}

// Exponential backoff (250ms base, capped at 8s) with full jitter.
function backoffMs(attempt: number): number {
  const base = Math.min(250 * 2 ** attempt, 8000);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

// Constrains a value to the inclusive [min, max] range.
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Sleeps for the given delay, rejecting early with an APIConnectionError if the
// caller's signal aborts during the wait so retries don't outlive a cancellation.
function backoffSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new APIConnectionError("Request aborted by caller"));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new APIConnectionError("Request aborted by caller during retry backoff"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
