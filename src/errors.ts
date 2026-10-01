// Typed error hierarchy for the SDK. Every failure surfaces as a NeevError
// subclass so callers can branch on `instanceof` rather than parsing strings.

import type { components } from "./generated/aiagent.js";

// Machine-readable classification of an API failure. Branch on this rather than on
// the message text, which may be reworded at any time.
export type ErrorCode = NonNullable<components["schemas"]["ErrorResponse"]["code"]>;

// Shape of the JSON error body returned by the API (components.schemas.ErrorResponse).
export interface ApiErrorBody {
  // Human-readable description of what went wrong.
  message?: string;
  // Machine-readable classification of the failure (an ErrorCode for API errors,
  // or the sandbox runtime's reason code for runtime errors).
  code?: string;
  // Which limit was hit, e.g. `organization` or `project`, when one applies.
  scope?: string;
  details?: string;
  /** @deprecated Carries the same text as `message`; read `message` instead. */
  error?: string;
}

// Base class for every error thrown by the SDK.
export class NeevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

// Raised when a request never produced an HTTP response — DNS failure, connection
// reset, or a client-side timeout/abort.
export class APIConnectionError extends NeevError {
  // The underlying cause (e.g. the fetch TypeError or AbortError), when available.
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

// Raised when the request was aborted because it exceeded the configured timeout.
export class APITimeoutError extends APIConnectionError {}

// Raised for any non-2xx HTTP response. Subclasses pin specific status codes.
export class APIError extends NeevError {
  // HTTP status code of the response.
  readonly status: number;
  // Machine-readable error code from the API body (`code` field), when present.
  // Branch on this rather than on the message text. API errors carry an ErrorCode;
  // sandbox runtime errors carry the runtime's reason code.
  readonly code?: ErrorCode | (string & {});
  // Which limit was hit (e.g. `organization` or `project`), when the body says.
  readonly scope?: string;
  // Human-readable detail from the API body (`details` field), when present.
  readonly details?: string;
  // Value of the `x-request-id` response header, for support correlation.
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody | undefined, requestId: string | undefined) {
    super(buildMessage(status, body, requestId));
    this.status = status;
    this.code = body?.code;
    this.scope = body?.scope;
    this.details = body?.details;
    this.requestId = requestId;
  }
}

// 400 — request was malformed or failed validation.
export class BadRequestError extends APIError {}
// 401 — missing, invalid, or expired API key.
export class AuthenticationError extends APIError {}
// 403 — authenticated but not allowed to touch this org/project/resource.
export class PermissionDeniedError extends APIError {}
// 404 — the requested resource does not exist.
export class NotFoundError extends APIError {}
// 409 — the resource already exists or conflicts with current state.
export class ConflictError extends APIError {}
// 412 — a precondition failed (e.g. unsupported protocol version).
export class PreconditionFailedError extends APIError {}
// 429 — rate limit exceeded.
export class RateLimitError extends APIError {}
// 504 — the operation exceeded the server's deadline.
export class DeadlineExceededError extends APIError {}
// 5xx — the server failed to handle a valid request.
export class InternalServerError extends APIError {}
// 503 — temporarily unavailable; retry shortly.
export class ServiceUnavailableError extends InternalServerError {}

// Composes a readable message from the status line and any API-provided detail.
function buildMessage(
  status: number,
  body: ApiErrorBody | undefined,
  requestId: string | undefined,
): string {
  const parts = [`HTTP ${status}`];
  const text = body?.message ?? body?.error;
  const label = body?.code && text ? `${body.code}: ${text}` : (body?.code ?? text);
  if (label) parts.push(label);
  if (body?.details) parts.push(`(${body.details})`);
  if (requestId) parts.push(`[request-id: ${requestId}]`);
  return parts.join(" ");
}

// Maps an HTTP status code and parsed body onto the most specific APIError subclass.
export function errorFromStatus(
  status: number,
  body: ApiErrorBody | undefined,
  requestId: string | undefined,
): APIError {
  switch (status) {
    case 400:
      return new BadRequestError(status, body, requestId);
    case 401:
      return new AuthenticationError(status, body, requestId);
    case 403:
      return new PermissionDeniedError(status, body, requestId);
    case 404:
      return new NotFoundError(status, body, requestId);
    case 409:
      return new ConflictError(status, body, requestId);
    case 412:
      return new PreconditionFailedError(status, body, requestId);
    case 429:
      return new RateLimitError(status, body, requestId);
    case 503:
      return new ServiceUnavailableError(status, body, requestId);
    case 504:
      return new DeadlineExceededError(status, body, requestId);
    default:
      if (status >= 500) return new InternalServerError(status, body, requestId);
      return new APIError(status, body, requestId);
  }
}

// Builds a typed APIError from a sandbox runtime error response body. The runtime
// answers {reason_code, message}; this maps it onto the SDK's {code, message}
// shape, keeping a non-JSON body as `details`.
export function errorFromSandboxBody(
  status: number,
  text: string,
  requestId: string | undefined,
): APIError {
  let body: ApiErrorBody | undefined;
  if (text.length > 0) {
    try {
      const parsed = JSON.parse(text) as { reason_code?: string; message?: string };
      body = { code: parsed.reason_code, message: parsed.message };
    } catch {
      body = { details: text };
    }
  }
  return errorFromStatus(status, body, requestId);
}
