import { decodeBase64 } from "./base64.js";
import { type APIError, type ApiErrorBody, NeevError, errorFromStatus } from "./errors.js";
import type { Dispatch } from "./http.js";
import { SandboxProcesses } from "./processes.js";

// Inputs needed to open a connection to a sandbox's daemon.
export interface SandboxConnectionOptions {
  // The sandbox's daemon base URL (Sandbox.connect_url).
  connectUrl: string;
  // Bearer API key; the gateway derives x-sandbox-id from the connect_url host.
  apiKey: string;
  // Shared transport; the no-retry dispatch, since sandbox calls are not idempotent.
  dispatch: Dispatch;
}

// A low-level request against the daemon, before body encoding/decoding.
interface DaemonRequest {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}

// Options for a file write.
export interface WriteFileOptions {
  // Working directory the path is resolved against, if relative.
  cwd?: string;
  // Caller cancellation signal.
  signal?: AbortSignal;
}

// Result of a successful file write.
export interface WriteFileResult {
  bytesWritten: number;
}

// Options for a file read.
export interface ReadFileOptions {
  // Working directory the path is resolved against, if relative.
  cwd?: string;
  // Caller cancellation signal.
  signal?: AbortSignal;
}

// Options for listing a directory.
export interface ListFilesOptions {
  // Working directory the path is resolved against, if relative.
  cwd?: string;
  // Recurse into subdirectories. Defaults to false (server-side).
  recursive?: boolean;
  // Maximum number of entries to return.
  maxCount?: number;
  // Caller cancellation signal.
  signal?: AbortSignal;
}

// A single directory entry returned by `files.list`.
export interface FileEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  // Path relative to the sandbox workspace root.
  path: string;
  size: number;
  // Raw Unix mode bits, including file-type bits; use `permissions` for the rwx view.
  mode: number;
  // 9-character rwx permission string (e.g. "rwxr-xr-x").
  permissions: string;
  // Last-modified timestamp (RFC3339).
  modifiedTime: string;
  // Target path when the entry is a symlink.
  symlinkTarget?: string;
}

// Options for running a command in the sandbox.
export interface ExecOptions {
  // Arguments, when the command is given as a bare program name. Ignored if
  // `command` is already an argv array.
  args?: string[];
  // Working directory for the command.
  cwd?: string;
  // Extra environment variables, merged over the sandbox's environment.
  env?: Record<string, string>;
  // Wall-clock timeout in milliseconds; the server clamps to its ceiling.
  timeoutMs?: number;
  // Data piped to the command's standard input.
  stdin?: string;
  // Caller cancellation signal.
  signal?: AbortSignal;
  // When true, `sandbox.exec` returns a live async-iterable of stdout/stderr/exit
  // events instead of a buffered ExecResult. Ignored by the lower-level
  // SandboxConnection methods, which expose buffering and streaming separately.
  stream?: boolean;
}

// Buffered result of a command. A non-zero exitCode is NOT an error. stdout and
// stderr are decoded as UTF-8 text (not binary-safe); the daemon does not report
// output truncation on this path, so output is captured in full.
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// One event from a streaming exec: `stdout`/`stderr` carry a decoded text chunk
// as it arrives, and the terminal `exit` event carries the process exit code.
export type ExecStreamEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; exitCode: number };

// A live connection to one sandbox's daemon (sandboxd), reached directly at the
// sandbox's connect_url. Construct via Neev.createSandboxConnection or, more
// commonly, access it through `sandbox.files` / `sandbox.exec`.
export class SandboxConnection {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly dispatch: Dispatch;
  // File operations on the sandbox filesystem.
  readonly files: SandboxFiles;
  // Process supervisor operations on the sandbox.
  readonly processes: SandboxProcesses;

  constructor(opts: SandboxConnectionOptions) {
    this.base = opts.connectUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.dispatch = opts.dispatch;
    this.files = new SandboxFiles(this);
    this.processes = new SandboxProcesses(this);
  }

  // Issues a request to the daemon and returns the raw Response, throwing a typed
  // APIError (mapped from the daemon's {reason_code, message}) on a non-2xx status.
  async request(req: DaemonRequest): Promise<Response> {
    const url = new URL(`${this.base}${req.path}`);
    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const headers = new Headers(req.headers);
    headers.set("authorization", `Bearer ${this.apiKey}`);
    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.body,
      signal: req.signal,
    });
    const response = await this.dispatch(request);
    if (!response.ok) throw await daemonError(response);
    return response;
  }

  // Runs a command in the sandbox and returns its buffered output. `command` may
  // be a program name (with `options.args`) or a full argv array. A non-zero exit
  // code is returned, not thrown. Built on `execStream`.
  async exec(command: string | string[], options: ExecOptions = {}): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    for await (const event of this.execStream(command, options)) {
      if (event.type === "stdout") stdout += event.data;
      else if (event.type === "stderr") stderr += event.data;
      else exitCode = event.exitCode;
    }
    return { stdout, stderr, exitCode };
  }

  // Runs a command and yields its output as it arrives: `stdout`/`stderr` events
  // carry decoded text chunks and a terminal `exit` event carries the exit code.
  // A non-zero exit is reported via the exit event, not thrown; a daemon error
  // frame throws a typed APIError, and a stream that ends without an exit throws.
  async *execStream(
    command: string | string[],
    options: ExecOptions = {},
  ): AsyncGenerator<ExecStreamEvent> {
    if (Array.isArray(command) && options.args && options.args.length > 0) {
      throw new NeevError(
        "exec: pass arguments either in the command array or via options.args, not both.",
      );
    }
    const argv = Array.isArray(command) ? command : [command, ...(options.args ?? [])];
    const [program, ...args] = argv;
    const env = options.env
      ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`)
      : undefined;
    const response = await this.request({
      method: "POST",
      path: "/v1/exec",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({
        command: program,
        args,
        cwd: options.cwd,
        env,
        timeout_ms: options.timeoutMs,
        stdin: options.stdin,
      }),
      signal: options.signal,
    });
    yield* streamExec(response);
  }
}

// Resolves the daemon connection for a file operation. The Sandbox handle
// supplies an async resolver that waits until the sandbox is Ready and caches
// the connection; a concrete SandboxConnection is wrapped as an already-resolved
// provider. Resolving per call lets `sandbox.files` stay a synchronous getter
// while the underlying connect_url may only arrive once the sandbox is Ready.
export type ConnectionResolver = () => Promise<SandboxConnection>;

// Filesystem operations exposed by sandboxd. Reached via `sandbox.files`.
export class SandboxFiles {
  private readonly resolve: ConnectionResolver;

  constructor(conn: SandboxConnection | ConnectionResolver) {
    this.resolve = typeof conn === "function" ? conn : () => Promise.resolve(conn);
  }

  // Writes content to a path in the sandbox, returning the number of bytes written.
  async write(
    path: string,
    content: string | Uint8Array,
    options: WriteFileOptions = {},
  ): Promise<WriteFileResult> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/files/write",
      query: { path, cwd: options.cwd },
      headers: { "content-type": "application/octet-stream" },
      body: content,
      signal: options.signal,
    });
    const body = (await response.json()) as { bytes_written: number };
    return { bytesWritten: body.bytes_written };
  }

  // Reads a file from the sandbox and returns its raw bytes (binary-safe).
  async read(path: string, options: ReadFileOptions = {}): Promise<Uint8Array> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/files/read",
      headers: { "content-type": "application/json", accept: "application/octet-stream" },
      body: JSON.stringify({ path, cwd: options.cwd }),
      signal: options.signal,
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  // Reads a file from the sandbox and decodes it as a UTF-8 string.
  async readText(path: string, options: ReadFileOptions = {}): Promise<string> {
    return new TextDecoder().decode(await this.read(path, options));
  }

  // Lists directory entries at a path in the sandbox.
  async list(path: string, options: ListFilesOptions = {}): Promise<FileEntry[]> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/files/list",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        cwd: options.cwd,
        recursive: options.recursive,
        max_count: options.maxCount,
      }),
      signal: options.signal,
    });
    const body = (await response.json()) as { entries: RawEntry[] };
    return body.entries.map(toFileEntry);
  }
}

// The wire shape of a directory entry as emitted by sandboxd.
interface RawEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  path: string;
  size: number;
  mode: number;
  permissions: string;
  modified_time: string;
  symlink_target?: string;
}

// One NDJSON frame of an exec stream.
interface ExecFrame {
  type: "stdout" | "stderr" | "exit" | "error";
  // Base64-encoded chunk for stdout/stderr frames.
  data?: string;
  // Process exit status, present on the terminal "exit" frame.
  exit_code?: number;
  // Failure detail on a terminal "error" frame.
  reason_code?: string;
  message?: string;
}

// sandboxd reason codes mapped to the HTTP status the SDK keys error types on.
const REASON_STATUS: Record<string, number> = {
  permission_denied: 403,
  invalid_argument: 400,
  not_found: 404,
  failed_precondition: 412,
  resource_exhausted: 429,
  deadline_exceeded: 504,
  unavailable: 503,
  internal: 500,
};

// Parses an NDJSON exec stream incrementally, yielding decoded output chunks as
// they arrive and a terminal exit event. Per-channel streaming TextDecoders keep
// a multi-byte UTF-8 sequence split across frames intact. A terminal "error"
// frame throws a typed APIError; a stream that ends without an exit status throws.
async function* streamExec(response: Response): AsyncGenerator<ExecStreamEvent> {
  const outDecoder = new TextDecoder();
  const errDecoder = new TextDecoder();
  let sawExit = false;

  // Turns one parsed frame into zero or more events; flips sawExit on the exit
  // frame and throws on an error frame.
  function* handle(frame: ExecFrame): Generator<ExecStreamEvent> {
    switch (frame.type) {
      case "stdout": {
        if (frame.data) {
          const text = outDecoder.decode(decodeBase64(frame.data), { stream: true });
          if (text) yield { type: "stdout", data: text };
        }
        break;
      }
      case "stderr": {
        if (frame.data) {
          const text = errDecoder.decode(decodeBase64(frame.data), { stream: true });
          if (text) yield { type: "stderr", data: text };
        }
        break;
      }
      case "exit": {
        // Flush any bytes the streaming decoders are still holding.
        const restOut = outDecoder.decode();
        if (restOut) yield { type: "stdout", data: restOut };
        const restErr = errDecoder.decode();
        if (restErr) yield { type: "stderr", data: restErr };
        sawExit = true;
        yield { type: "exit", exitCode: frame.exit_code ?? 0 };
        break;
      }
      case "error":
        throw errorFromStatus(
          (frame.reason_code && REASON_STATUS[frame.reason_code]) || 500,
          { error: frame.reason_code ?? "", details: frame.message },
          undefined,
        );
    }
  }

  const lineDecoder = new TextDecoder();
  let buffer = "";

  if (response.body) {
    // Read the body as it arrives, parsing complete NDJSON lines incrementally.
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buffer += lineDecoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) yield* handle(JSON.parse(line) as ExecFrame);
          newline = buffer.indexOf("\n");
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
    const tail = (buffer + lineDecoder.decode()).trim();
    if (tail) yield* handle(JSON.parse(tail) as ExecFrame);
  } else {
    // Fallback when the runtime exposes no streaming body: parse the full text.
    for (const line of (await response.text()).split("\n")) {
      const trimmed = line.trim();
      if (trimmed) yield* handle(JSON.parse(trimmed) as ExecFrame);
    }
  }

  if (!sawExit) {
    throw new NeevError(
      "exec stream ended without an exit status (the command may have timed out).",
    );
  }
}

// Maps a sandboxd entry onto the SDK's camelCase FileEntry.
function toFileEntry(entry: RawEntry): FileEntry {
  return {
    name: entry.name,
    type: entry.type,
    path: entry.path,
    size: entry.size,
    mode: entry.mode,
    permissions: entry.permissions,
    modifiedTime: entry.modified_time,
    symlinkTarget: entry.symlink_target,
  };
}

// Builds a typed APIError from a sandboxd error response. The daemon's body is
// {reason_code, message}; this maps it onto the SDK's {error, details} shape.
async function daemonError(response: Response): Promise<APIError> {
  const text = await response.text();
  let body: ApiErrorBody | undefined;
  if (text.length > 0) {
    try {
      const parsed = JSON.parse(text) as { reason_code?: string; message?: string };
      body = { error: parsed.reason_code ?? "", details: parsed.message };
    } catch {
      body = { error: "", details: text };
    }
  }
  return errorFromStatus(response.status, body, response.headers.get("x-request-id") ?? undefined);
}
