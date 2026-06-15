import { decodeBase64 } from "./base64.js";
import { NeevError } from "./errors.js";
import type { ConnectionResolver, SandboxConnection } from "./sandboxd.js";

// Lifecycle state of a supervised process, as reported by the daemon.
export type ProcessState = "running" | "exited";

// Options for starting a detached process.
export interface StartProcessOptions {
  // Arguments, when the command is given as a bare program name. Passing both an
  // argv array `command` and a non-empty `args` throws.
  args?: string[];
  // Working directory, relative to the sandbox workspace root.
  cwd?: string;
  // Extra environment variables, merged over the sandbox's environment.
  env?: Record<string, string>;
  // Data fed to the process's standard input at startup.
  stdin?: string;
  // Caller cancellation signal for the start request.
  signal?: AbortSignal;
}

// Options for querying a process's status.
export interface ProcessStatusOptions {
  // Block until the process exits (bounded by the daemon's wait ceiling).
  wait?: boolean;
  // Caller cancellation signal for the request.
  signal?: AbortSignal;
}

// Options shared by the unary list call and the log reads.
export interface ProcessRequestOptions {
  // Caller cancellation signal for the request.
  signal?: AbortSignal;
}

// Options for reading a process's captured output.
export interface ProcessLogsOptions {
  // Combined-stream byte offset to read from; 0 (default) is the oldest
  // retained byte.
  cursor?: number;
  // Caller cancellation signal for the request.
  signal?: AbortSignal;
}

// A status snapshot of one supervised process.
export interface ProcessStatus {
  processId: string;
  state: ProcessState;
  // Exit code once exited; null while running.
  exitCode: number | null;
  // Spawn time in epoch milliseconds.
  startedAt: number;
}

// A list entry describing one tracked process, including how it was started.
export interface ProcessInfo {
  processId: string;
  // Program that was executed.
  name: string;
  args: string[];
  cwd: string;
  state: ProcessState;
  // Exit code once exited; null while running.
  exitCode: number | null;
  // Spawn time in epoch milliseconds.
  startedAt: number;
}

// One captured output record from a poll read; `data` is decoded UTF-8 text.
export interface ProcessLogEntry {
  stream: "stdout" | "stderr";
  data: string;
}

// One page of polled output plus the cursor to resume from.
export interface ProcessLogsPage {
  entries: ProcessLogEntry[];
  // Offset to pass on the next poll to resume after these entries.
  cursor: number;
  // True when output before the requested cursor was evicted before it was read.
  dropped: boolean;
  // Process lifecycle state at read time.
  state: ProcessState;
}

// One event from a follow stream: `stdout`/`stderr` carry a decoded text chunk
// as it arrives, and a terminal `exit` event carries the exit code.
export type ProcessLogEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; exitCode: number };

// Signal numbers the daemon accepts for kill/kill-all; any other value is
// rejected as invalid_argument. 0 (the default) is delivered as SIGTERM.
export const Signal = {
  HUP: 1,
  INT: 2,
  QUIT: 3,
  KILL: 9,
  TERM: 15,
} as const;

// Wire shapes emitted by the daemon (snake_case), mapped to the public types.
interface RawStatus {
  process_id: string;
  state: ProcessState;
  exit_code: number | null;
  started_at: number;
}

interface RawInfo extends RawStatus {
  name: string;
  args: string[];
  cwd: string;
}

// One NDJSON frame of a follow stream. stdout/stderr carry base64 `data`; the
// terminal exit frame carries `exit_code`.
interface FollowFrame {
  type: "stdout" | "stderr" | "exit";
  data?: string;
  exit_code?: number;
}

// Process management exposed by the sandboxd process supervisor. Reached via
// `sandbox.processes`. Each operation resolves the daemon connection lazily,
// waiting until the sandbox is Ready on first use, exactly like `sandbox.files`.
export class SandboxProcesses {
  private readonly resolve: ConnectionResolver;

  constructor(conn: SandboxConnection | ConnectionResolver) {
    // Accept a resolver (lazy, from the Sandbox handle) or an already-resolved
    // connection (wrapped as an immediate resolver), mirroring SandboxFiles.
    this.resolve = typeof conn === "function" ? conn : () => Promise.resolve(conn);
  }

  // Starts a detached process and returns a handle to it. `command` may be a
  // program name (with `options.args`) or a full argv array; passing both an
  // argv array and `options.args` throws.
  async start(command: string | string[], options: StartProcessOptions = {}): Promise<Process> {
    if (Array.isArray(command) && options.args && options.args.length > 0) {
      throw new NeevError(
        "processes.start: pass arguments either in the command array or via options.args, not both.",
      );
    }
    const argv = Array.isArray(command) ? command : [command, ...(options.args ?? [])];
    const [program, ...args] = argv;
    // An empty argv array or empty program name would send a malformed request.
    if (!program) {
      throw new NeevError("processes.start: a non-empty program is required.");
    }
    // The daemon takes env as ["K=V", ...]; convert from the ergonomic record.
    const env = options.env
      ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`)
      : undefined;
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/processes/start",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ program, args, cwd: options.cwd, env, stdin: options.stdin }),
      signal: options.signal,
    });
    const body = (await response.json()) as RawStatus;
    return new Process(this, toStatus(body));
  }

  // Fetches a status snapshot for a process. With `wait: true` it blocks until
  // the process exits (bounded by the daemon's wait ceiling).
  async get(processId: string, options: ProcessStatusOptions = {}): Promise<ProcessStatus> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/processes/get",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ process_id: processId, wait: options.wait }),
      signal: options.signal,
    });
    return toStatus((await response.json()) as RawStatus);
  }

  // Lists all tracked processes (running plus recently-exited, retained ones).
  async list(options: ProcessRequestOptions = {}): Promise<ProcessInfo[]> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/processes/list",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: options.signal,
    });
    const body = (await response.json()) as { processes: RawInfo[] };
    return body.processes.map(toInfo);
  }

  // Signals one process. `signal` defaults to SIGTERM (0). Returns whether a
  // signal was actually delivered (false when the process had already exited).
  async kill(processId: string, signal?: number): Promise<boolean> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/processes/kill",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ process_id: processId, signal }),
    });
    const body = (await response.json()) as { signalled: boolean };
    return body.signalled;
  }

  // Signals every running process. `signal` defaults to SIGTERM (0). Returns the
  // number of processes the signal was delivered to.
  async killAll(signal?: number): Promise<number> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/processes/kill-all",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signal }),
    });
    const body = (await response.json()) as { signalled_count: number };
    return body.signalled_count;
  }

  // Reads a page of a process's captured output from `cursor`, with the cursor
  // to resume from. `dropped` is true when output before the cursor was evicted.
  async logs(processId: string, options: ProcessLogsOptions = {}): Promise<ProcessLogsPage> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/processes/logs",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ process_id: processId, cursor: options.cursor }),
      signal: options.signal,
    });
    const body = (await response.json()) as {
      entries: ProcessLogEntry[];
      cursor: number;
      dropped: boolean;
      state: ProcessState;
    };
    return {
      entries: body.entries,
      cursor: body.cursor,
      dropped: body.dropped,
      state: body.state,
    };
  }

  // Follows a process's output, yielding stdout/stderr text chunks as they are
  // produced and a terminal exit event when the process exits. Resumes from
  // `cursor` (0 = oldest retained byte). A caller abort ends the stream cleanly
  // without an exit event.
  async *follow(
    processId: string,
    options: ProcessLogsOptions = {},
  ): AsyncGenerator<ProcessLogEvent> {
    const conn = await this.resolve();
    const response = await conn.request({
      method: "POST",
      path: "/v1/processes/logs",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({ process_id: processId, cursor: options.cursor, follow: true }),
      signal: options.signal,
    });
    yield* streamProcessLogs(response);
  }
}

// A handle to one supervised process. Carries the latest known snapshot and
// offers actions that operate on this process by id. Construct via
// `sandbox.processes.start`.
export class Process {
  private readonly processes: SandboxProcesses;
  private snapshot: ProcessStatus;

  constructor(processes: SandboxProcesses, status: ProcessStatus) {
    this.processes = processes;
    this.snapshot = status;
  }

  // Supervisor-assigned process id.
  get id(): string {
    return this.snapshot.processId;
  }

  // Last-known lifecycle state (updated by status()/wait()).
  get state(): ProcessState {
    return this.snapshot.state;
  }

  // Last-known exit code; null while running.
  get exitCode(): number | null {
    return this.snapshot.exitCode;
  }

  // Spawn time in epoch milliseconds.
  get startedAt(): number {
    return this.snapshot.startedAt;
  }

  // Refreshes and returns this process's status without blocking.
  async status(options: ProcessRequestOptions = {}): Promise<ProcessStatus> {
    this.snapshot = await this.processes.get(this.id, { signal: options.signal });
    return this.snapshot;
  }

  // Blocks until the process exits, then returns and caches its terminal status.
  async wait(options: ProcessRequestOptions = {}): Promise<ProcessStatus> {
    this.snapshot = await this.processes.get(this.id, { wait: true, signal: options.signal });
    return this.snapshot;
  }

  // Signals this process. `signal` defaults to SIGTERM. Returns whether a signal
  // was delivered (false when already exited).
  kill(signal?: number): Promise<boolean> {
    return this.processes.kill(this.id, signal);
  }

  // Reads a page of this process's captured output from `cursor`.
  logs(options: ProcessLogsOptions = {}): Promise<ProcessLogsPage> {
    return this.processes.logs(this.id, options);
  }

  // Follows this process's output until it exits (or the caller aborts).
  follow(options: ProcessLogsOptions = {}): AsyncGenerator<ProcessLogEvent> {
    return this.processes.follow(this.id, options);
  }
}

// Maps a daemon status record onto the SDK's camelCase ProcessStatus.
function toStatus(raw: RawStatus): ProcessStatus {
  return {
    processId: raw.process_id,
    state: raw.state,
    exitCode: raw.exit_code,
    startedAt: raw.started_at,
  };
}

// Maps a daemon list record onto the SDK's camelCase ProcessInfo.
function toInfo(raw: RawInfo): ProcessInfo {
  return {
    processId: raw.process_id,
    name: raw.name,
    args: raw.args,
    cwd: raw.cwd,
    state: raw.state,
    exitCode: raw.exit_code,
    startedAt: raw.started_at,
  };
}

// Parses an NDJSON follow stream incrementally, yielding decoded output chunks
// and a terminal exit event. Per-channel streaming TextDecoders keep a multi-byte
// UTF-8 sequence split across frames intact. Unlike the exec stream, a follow
// that ends without an exit frame is a normal abort/disconnect, not an error, so
// this never throws on a missing exit.
async function* streamProcessLogs(response: Response): AsyncGenerator<ProcessLogEvent> {
  const outDecoder = new TextDecoder();
  const errDecoder = new TextDecoder();

  // Turns one parsed frame into zero or more events.
  function* handle(frame: FollowFrame): Generator<ProcessLogEvent> {
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
        // Flush any bytes the streaming decoders are still holding before exit.
        const restOut = outDecoder.decode();
        if (restOut) yield { type: "stdout", data: restOut };
        const restErr = errDecoder.decode();
        if (restErr) yield { type: "stderr", data: restErr };
        yield { type: "exit", exitCode: frame.exit_code ?? 0 };
        break;
      }
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
          if (line) yield* handle(JSON.parse(line) as FollowFrame);
          newline = buffer.indexOf("\n");
        }
        if (done) break;
      }
    } finally {
      // Cancel the underlying stream so an early `break` from the consumer (or an
      // abort) tears down the follow HTTP request instead of leaking it. cancel()
      // also releases the reader lock; it is a no-op once the stream is drained.
      await reader.cancel().catch(() => {});
    }
    const tail = (buffer + lineDecoder.decode()).trim();
    if (tail) yield* handle(JSON.parse(tail) as FollowFrame);
  } else {
    // Fallback when the runtime exposes no streaming body: parse the full text.
    for (const line of (await response.text()).split("\n")) {
      const trimmed = line.trim();
      if (trimmed) yield* handle(JSON.parse(trimmed) as FollowFrame);
    }
  }
}
