import { APIConnectionError, APIError, APITimeoutError, NeevError } from "./errors.js";
import type { ConnectionResolver, SandboxConnection } from "./runtime.js";

// How a run ended. `error` means the code raised (see `Execution.error`);
// `kernel_restarted` and `memory_exceeded` mean the context's state was lost.
export type CodeEndReason =
  | "ok"
  | "error"
  | "deadline_exceeded"
  | "kernel_restarted"
  | "memory_exceeded"
  | "unavailable"
  | "invalid_response"
  | (string & {});

// Kernel languages a context can run; `python` is the only one today.
export type CodeLanguage = "python" | (string & {});

// One piece of output as it arrived.
export interface OutputMessage {
  // The text, which may hold several lines or part of one.
  line: string;
  // When it arrived, in Unix epoch milliseconds.
  timestamp: number;
  // True for stderr.
  error: boolean;
}

// One display value. `data` maps MIME type to value; the accessors read the common ones.
export class CodeResult {
  readonly data: Record<string, unknown>;
  // True for the value of the code's last expression.
  readonly isMain: boolean;

  constructor(data: Record<string, unknown>, isMain: boolean) {
    this.data = data;
    this.isMain = isMain;
  }

  // The MIME types this result carries.
  formats(): string[] {
    return Object.keys(this.data);
  }

  get text(): string | undefined {
    return this.str("text/plain");
  }
  get html(): string | undefined {
    return this.str("text/html");
  }
  get markdown(): string | undefined {
    return this.str("text/markdown");
  }
  get latex(): string | undefined {
    return this.str("text/latex");
  }
  get svg(): string | undefined {
    return this.str("image/svg+xml");
  }
  // Base64-encoded image bytes.
  get png(): string | undefined {
    return this.str("image/png");
  }
  get jpeg(): string | undefined {
    return this.str("image/jpeg");
  }
  get pdf(): string | undefined {
    return this.str("application/pdf");
  }
  get javascript(): string | undefined {
    return this.str("application/javascript");
  }
  // Structured JSON output, as the kernel sent it.
  get json(): unknown {
    return this.data["application/json"];
  }

  // Plain data for JSON.stringify and structured logging.
  toJSON(): { data: Record<string, unknown>; isMain: boolean } {
    return { data: this.data, isMain: this.isMain };
  }

  private str(type: string): string | undefined {
    const value = this.data[type];
    return typeof value === "string" ? value : undefined;
  }
}

// The exception the code raised.
export interface CodeError {
  name: string;
  value: string;
  traceback: string[];
}

// Everything one run produced.
export interface Execution {
  // All stdout and stderr text, joined.
  stdout: string;
  stderr: string;
  // The same output, one entry per piece as it arrived.
  logs: { stdout: string[]; stderr: string[] };
  results: CodeResult[];
  // The text of the last expression's value, when it has one.
  text?: string;
  // Set when the code raised.
  error?: CodeError;
  endReason: CodeEndReason;
  // The cell's number in its context, when the kernel numbered it.
  executionCount?: number;
  // The context's generation; a change between runs means its state was lost.
  generation: string;
  // True when an oversized output was dropped.
  truncated: boolean;
}

// A context, or its id.
export type CodeContextRef = string | { contextId: string };

// Options for running code.
export interface RunCodeOptions {
  // Context to run in, or its id; omitted uses the sandbox's default context.
  context?: CodeContextRef;
  // Language of the default context to use when no context is given; `python` today.
  language?: CodeLanguage;
  // Environment variables for this run only; code it starts sees them too.
  envs?: Record<string, string>;
  // Run timeout in milliseconds; the sandbox clamps it to its ceiling, which is also the default.
  timeoutMs?: number;
  // Bound on the whole request in milliseconds, output included; unset leaves it to timeoutMs.
  requestTimeoutMs?: number;
  // Caller cancellation signal.
  signal?: AbortSignal;
  // Called with each piece of output as it arrives.
  onStdout?: (output: OutputMessage) => void;
  onStderr?: (output: OutputMessage) => void;
  onResult?: (result: CodeResult) => void;
  onError?: (error: CodeError) => void;
}

// Options for the context calls.
export interface CodeContextOptions {
  // Caller cancellation signal.
  signal?: AbortSignal;
  // Bound on the request in milliseconds.
  requestTimeoutMs?: number;
}

// Options for creating a context.
export interface CreateCodeContextOptions extends CodeContextOptions {
  // Kernel language; `python`, the default, is the only one today.
  language?: CodeLanguage;
  // Directory the kernel starts in, absolute or relative to the workspace; it must exist.
  cwd?: string;
}

// A context just created; its kernel may still be starting.
export interface CreatedCodeContext {
  contextId: string;
  generation: string;
  language?: string;
  cwd?: string;
}

// One context: a kernel with its own state.
export interface CodeContext {
  contextId: string;
  state: "idle" | "busy";
  generation: string;
  language?: string;
  cwd?: string;
  // Resident memory in MiB.
  rssMib: number;
}

// One NDJSON event of a run, as sent by the sandbox.
interface RunFrame {
  type: "stream" | "result" | "error" | "keepalive" | "end";
  name?: string;
  text?: string;
  data?: Record<string, unknown>;
  is_main?: boolean;
  value?: string;
  traceback?: string[];
  reason?: string;
  generation?: string;
  execution_count?: number;
  truncated?: boolean;
}

interface RawContext {
  context_id: string;
  state: "idle" | "busy";
  generation: string;
  language?: string;
  cwd?: string;
  rss_mib: number;
}

// Runs code in persistent kernels, in sandboxes created from the interpreter template.
// Reached via `sandbox.code`; the connection resolves lazily like `sandbox.files`.
export class SandboxCode {
  private readonly resolve: ConnectionResolver;

  constructor(conn: SandboxConnection | ConnectionResolver) {
    this.resolve = typeof conn === "function" ? conn : () => Promise.resolve(conn);
  }

  // Runs code and returns everything it produced; the callbacks see output as it arrives.
  // Code that raises is not thrown: it ends with `endReason: "error"` and `error` set.
  // A run refused before it started (busy context, no interpreter) throws an APIError.
  // A paused sandbox is woken; the call waits for it up to two minutes.
  async run(code: string, options: RunCodeOptions = {}): Promise<Execution> {
    if (options.context !== undefined && options.language !== undefined) {
      throw new NeevError("code.run: pass a context or a language, not both.");
    }
    if (options.language !== undefined && options.language !== "python") {
      throw new NeevError(
        `code.run: language ${JSON.stringify(options.language)} is not supported; use "python".`,
      );
    }
    const conn = await this.resolve();
    return withRequestTimeout(options.signal, options.requestTimeoutMs, (signal) =>
      whileWaking(signal, async () => {
        const response = await conn.request({
          method: "POST",
          path: "/v1/interpreter/run",
          headers: {
            "content-type": "application/json",
            accept: "application/x-ndjson",
            ...NO_WAIT,
          },
          body: JSON.stringify({
            code,
            context_id: options.context === undefined ? undefined : contextIdOf(options.context),
            timeout_ms: options.timeoutMs,
            envs: options.envs,
          }),
          signal,
        });
        return collect(response, options);
      }),
    );
  }

  // Creates a named context with its own state. Its kernel starts in the background;
  // a run sent before it is ready waits for it.
  async createContext(options: CreateCodeContextOptions = {}): Promise<CreatedCodeContext> {
    const body = (await this.call(
      "create",
      { language: options.language, cwd: options.cwd },
      options,
    )) as RawContext;
    return {
      contextId: body.context_id,
      generation: body.generation,
      language: body.language,
      cwd: body.cwd,
    };
  }

  // Lists the sandbox's contexts.
  async listContexts(options: CodeContextOptions = {}): Promise<CodeContext[]> {
    const body = (await this.call("list", {}, options)) as { contexts: RawContext[] };
    return body.contexts.map((c) => ({
      contextId: c.context_id,
      state: c.state,
      generation: c.generation,
      language: c.language,
      cwd: c.cwd,
      rssMib: c.rss_mib,
    }));
  }

  // Restarts a context, dropping its state, and returns its new generation.
  async restartContext(context: CodeContextRef, options: CodeContextOptions = {}): Promise<string> {
    const body = (await this.call("restart", { context_id: contextIdOf(context) }, options)) as {
      generation: string;
    };
    return body.generation;
  }

  // Deletes a named context; deleting `default` restarts it instead.
  async deleteContext(context: CodeContextRef, options: CodeContextOptions = {}): Promise<void> {
    await this.call("delete", { context_id: contextIdOf(context) }, options);
  }

  // Calls one contexts route and returns its decoded body.
  private async call(
    op: string,
    payload: Record<string, unknown>,
    options: CodeContextOptions,
  ): Promise<unknown> {
    const conn = await this.resolve();
    return withRequestTimeout(options.signal, options.requestTimeoutMs, (signal) =>
      whileWaking(signal, async () => {
        const response = await conn.request({
          method: "POST",
          path: `/v1/interpreter/contexts/${op}`,
          headers: { "content-type": "application/json", ...NO_WAIT },
          body: JSON.stringify(payload),
          signal,
        });
        return response.json();
      }),
    );
  }
}

// Returns the id of a context or of an id.
function contextIdOf(context: CodeContextRef): string {
  return typeof context === "string" ? context : context.contextId;
}

// Asks not to be held while a paused sandbox wakes; the SDK retries instead.
const NO_WAIT = { prefer: "wait=0" };

// How long a call keeps retrying a sandbox that is waking, and how often.
const WAKE_BUDGET_MS = 120_000;
const WAKE_RETRY_MS = 2_000;

// Retries fn while the sandbox is waking; that answer precedes the cell, so none runs twice.
async function whileWaking<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  const until = Date.now() + WAKE_BUDGET_MS;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const left = until - Date.now();
      if (!(err instanceof APIError) || err.reason !== "sandbox_waking" || left <= 0) throw err;
      await sleep(Math.min(WAKE_RETRY_MS, left), signal);
    }
  }
}

// Waits ms, rejecting early if the signal aborts.
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new APIConnectionError("Request aborted while the sandbox was waking"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Runs fn under the caller's signal and, when timeoutMs is set, a bound on the whole
// request; a request the bound cut off throws APITimeoutError.
async function withRequestTimeout<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  fn: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (timeoutMs === undefined) return fn(signal);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forward = () => controller.abort(signal?.reason);
  if (signal?.aborted) forward();
  signal?.addEventListener("abort", forward, { once: true });
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (timedOut) throw new APITimeoutError(`request timed out after ${timeoutMs} ms`, err);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

// Reads a run's events into an Execution, calling back as each arrives.
async function collect(response: Response, options: RunCodeOptions): Promise<Execution> {
  const out: Execution = {
    stdout: "",
    stderr: "",
    logs: { stdout: [], stderr: [] },
    results: [],
    endReason: "",
    generation: "",
    truncated: false,
  };
  for await (const frame of readFrames(response)) {
    switch (frame.type) {
      case "stream": {
        const isErr = frame.name === "stderr";
        const message = { line: frame.text ?? "", timestamp: Date.now(), error: isErr };
        if (isErr) {
          out.stderr += message.line;
          out.logs.stderr.push(message.line);
          options.onStderr?.(message);
        } else {
          out.stdout += message.line;
          out.logs.stdout.push(message.line);
          options.onStdout?.(message);
        }
        break;
      }
      case "result": {
        const result = new CodeResult(frame.data ?? {}, frame.is_main ?? false);
        out.results.push(result);
        if (result.isMain) out.text = result.text;
        options.onResult?.(result);
        break;
      }
      case "error": {
        const error = {
          name: frame.name ?? "",
          value: frame.value ?? "",
          traceback: frame.traceback ?? [],
        };
        out.error = error;
        options.onError?.(error);
        break;
      }
      case "end":
        out.endReason = frame.reason ?? "";
        out.generation = frame.generation ?? "";
        out.executionCount = frame.execution_count;
        out.truncated = frame.truncated ?? false;
        return out;
    }
  }
  // Every run ends with an end event, so a stream without one was cut short.
  throw new NeevError("code run ended without an end event: its output is incomplete.");
}

// Yields a run's NDJSON events as they arrive, skipping keepalives.
async function* readFrames(response: Response): AsyncGenerator<RunFrame> {
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = function* (text: string): Generator<RunFrame> {
    const line = text.trim();
    if (!line) return;
    const frame = JSON.parse(line) as RunFrame;
    if (frame.type !== "keepalive") yield frame;
  };
  if (!response.body) {
    for (const line of (await response.text()).split("\n")) yield* parse(line);
    return;
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        yield* parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  yield* parse(buffer + decoder.decode());
}
