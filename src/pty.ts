import { NeevError } from "./errors.js";
import type { ConnectionResolver, SandboxConnection } from "./sandboxd.js";

// The minimal WebSocket the SDK drives for an interactive PTY. It is satisfied by the
// browser/Deno/Bun global `WebSocket` and by Node's `ws` package.
export interface SandboxWebSocket {
  binaryType: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
}

// Builds a SandboxWebSocket for a ws(s):// URL. `headers` carry the bearer auth; runtimes
// whose WebSocket cannot set request headers (browser/Deno/Bun) ignore them. In Node, pass
// a factory backed by the `ws` package so the auth header is sent, e.g.
//   new Neev({ webSocket: (url, opts) => new WebSocket(url, opts) })
export type WebSocketFactory = (
  url: string,
  options: { headers: Record<string, string> },
) => SandboxWebSocket;

// Options for opening a PTY session.
export interface PtyCreateOptions {
  // Program to run; defaults to the daemon's default shell when omitted.
  program?: string;
  args?: string[];
  // Initial terminal size in characters; 0/omitted leaves the daemon default.
  cols?: number;
  rows?: number;
  // Called with each chunk of terminal output as it arrives.
  onData?: (chunk: Uint8Array) => void;
}

// The terminal outcome of a PTY session.
export interface PtyResult {
  exitCode: number;
}

// PTY operations on a sandbox, reached via `sandbox.pty`. `create` opens an interactive
// session and returns a PtyHandle to drive it.
export class SandboxPty {
  private readonly resolve: ConnectionResolver;

  constructor(conn: SandboxConnection | ConnectionResolver) {
    this.resolve = typeof conn === "function" ? conn : () => Promise.resolve(conn);
  }

  // Opens an interactive PTY and resolves once the socket is connected. `onData` receives
  // output as it arrives; drive the session with the returned handle.
  async create(options: PtyCreateOptions = {}): Promise<PtyHandle> {
    const conn = await this.resolve();
    const query: Record<string, string> = {};
    if (options.program) query.program = options.program;
    if (options.cols && options.cols > 0) query.cols = String(options.cols);
    if (options.rows && options.rows > 0) query.rows = String(options.rows);
    const search = new URLSearchParams(query);
    for (const arg of options.args ?? []) search.append("arg", arg);
    const ws = conn.openPtySocket(search);
    const handle = new PtyHandle(ws, options.onData);
    await handle.connected();
    return handle;
  }
}

// One client→server control frame (resize or signal).
interface PtyControlFrame {
  type: "resize" | "signal";
  cols?: number;
  rows?: number;
  signal?: string;
}

// A live interactive PTY session. Send keystrokes with `sendInput`, react to terminal
// resizes with `resize`, end it with `kill`/`disconnect`, and await its exit with `wait`.
export class PtyHandle {
  private readonly ws: SandboxWebSocket;
  private readonly encoder = new TextEncoder();
  // Resolved once the child exits (exit frame) or the socket closes.
  private exitCode = 0;
  private readonly done: Promise<PtyResult>;
  private resolveDone!: (result: PtyResult) => void;
  // Resolved on open, rejected if the socket errors/closes before opening.
  private readonly open: Promise<void>;

  constructor(ws: SandboxWebSocket, onData?: (chunk: Uint8Array) => void) {
    this.ws = ws;
    this.ws.binaryType = "arraybuffer";
    let settledOpen = false;
    let resolveOpen!: () => void;
    let rejectOpen!: (err: unknown) => void;
    this.open = new Promise((res, rej) => {
      resolveOpen = res;
      rejectOpen = rej;
    });
    this.done = new Promise((res) => {
      this.resolveDone = res;
    });

    this.ws.addEventListener("open", () => {
      settledOpen = true;
      resolveOpen();
    });
    this.ws.addEventListener("message", (event) => {
      // Binary frames are terminal output; a text frame is the terminal exit notice.
      const bytes = asBytes(event.data);
      if (bytes) {
        onData?.(bytes);
        return;
      }
      if (typeof event.data === "string") {
        try {
          const frame = JSON.parse(event.data) as { type?: string; exit_code?: number };
          if (frame.type === "exit" && typeof frame.exit_code === "number") {
            this.exitCode = frame.exit_code;
          }
        } catch {
          // Ignore non-JSON text frames.
        }
      }
    });
    this.ws.addEventListener("close", () => {
      if (!settledOpen) rejectOpen(new NeevError("pty connection closed before it opened"));
      this.resolveDone({ exitCode: this.exitCode });
    });
    this.ws.addEventListener("error", (err) => {
      if (!settledOpen) {
        rejectOpen(new NeevError(`pty connection failed: ${describeError(err)}`));
        return;
      }
      // After open, an error may arrive without a subsequent close; end wait too
      // (resolve is idempotent, so a following close is harmless).
      this.resolveDone({ exitCode: this.exitCode });
    });
  }

  // Resolves once the session is connected (or rejects if it failed to open).
  connected(): Promise<void> {
    return this.open;
  }

  // Sends keystrokes/bytes to the terminal's standard input.
  sendInput(data: string | Uint8Array): void {
    this.ws.send(typeof data === "string" ? this.encoder.encode(data) : data);
  }

  // Tells the remote terminal its window changed size (cols/rows in characters).
  resize(cols: number, rows: number): void {
    this.sendControl({ type: "resize", cols, rows });
  }

  // Sends a signal to the process group by name (default SIGTERM; accepted:
  // SIGINT, SIGTERM, SIGHUP, SIGQUIT, SIGKILL).
  kill(signal = "SIGTERM"): void {
    this.sendControl({ type: "signal", signal });
  }

  // Reads terminal output until the session ends, returning the exit code.
  wait(): Promise<PtyResult> {
    return this.done;
  }

  // Closes the WebSocket; the daemon reaps the child. `wait` then resolves.
  disconnect(): void {
    this.ws.close();
  }

  // Sends a JSON control frame as a text message.
  private sendControl(frame: PtyControlFrame): void {
    this.ws.send(JSON.stringify(frame));
  }
}

// asBytes returns terminal-output bytes from a message payload, or null for text frames.
function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

// describeError extracts a readable message from a WebSocket error event.
function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "connection error";
}
