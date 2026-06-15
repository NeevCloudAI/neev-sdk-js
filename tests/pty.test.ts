import { describe, expect, it, vi } from "vitest";
import { SandboxConnection, type SandboxWebSocket, type WebSocketFactory } from "../src/index.js";

// FakeWS is a scriptable SandboxWebSocket: it auto-fires "open" (or "close" when fail:true)
// on the next microtask, records sends, and lets the test push message/close events.
class FakeWS implements SandboxWebSocket {
  binaryType = "";
  url = "";
  headers: Record<string, string> = {};
  sent: unknown[] = [];
  private listeners = new Map<string, ((ev: unknown) => void)[]>();

  constructor(opts: { fail?: boolean } = {}) {
    queueMicrotask(() => this.emit(opts.fail ? "close" : "open"));
  }
  addEventListener(type: string, listener: (ev: unknown) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }
  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(data);
  }
  close(): void {
    this.emit("close");
  }
  emit(type: string, ev?: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }
}

// connWith builds a SandboxConnection whose PTY uses a captured FakeWS.
function connWith(connectUrl: string, opts: { fail?: boolean } = {}) {
  let ws!: FakeWS;
  const factory: WebSocketFactory = (url, options) => {
    ws = new FakeWS(opts);
    ws.url = url;
    ws.headers = options.headers;
    return ws;
  };
  const conn = new SandboxConnection({
    connectUrl,
    apiKey: "k",
    dispatch: async () => new Response(),
    webSocket: factory,
  });
  return { conn, getWS: () => ws };
}

describe("pty", () => {
  it("dials wss /v1/pty with program/args/size and the bearer header", async () => {
    const { conn, getWS } = connWith("https://sbx.example");
    const handle = await conn.pty.create({ program: "bash", args: ["-l"], cols: 80, rows: 24 });
    const ws = getWS();
    expect(ws.url).toBe("wss://sbx.example/v1/pty?program=bash&cols=80&rows=24&arg=-l");
    expect(ws.headers.authorization).toBe("Bearer k");
    expect(ws.binaryType).toBe("arraybuffer");
    handle.disconnect();
  });

  it("maps http connect_url to ws", async () => {
    const { conn, getWS } = connWith("http://sbx.example");
    await conn.pty.create();
    expect(getWS().url).toBe("ws://sbx.example/v1/pty");
  });

  it("delivers binary output to onData and parses the exit frame for wait", async () => {
    const onData = vi.fn();
    const { conn, getWS } = connWith("https://sbx.example");
    const handle = await conn.pty.create({ onData });
    const ws = getWS();

    ws.emit("message", { data: new TextEncoder().encode("hello").buffer });
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData.mock.calls[0][0]).toEqual(new TextEncoder().encode("hello"));

    const waiting = handle.wait();
    ws.emit("message", { data: JSON.stringify({ type: "exit", exit_code: 7 }) });
    ws.emit("close");
    expect(await waiting).toEqual({ exitCode: 7 });
  });

  it("sends stdin as binary and resize/kill as JSON control frames", async () => {
    const { conn, getWS } = connWith("https://sbx.example");
    const handle = await conn.pty.create();
    const ws = getWS();

    handle.sendInput("ls\n");
    expect(ws.sent.at(-1)).toEqual(new TextEncoder().encode("ls\n"));

    handle.resize(120, 40);
    expect(ws.sent.at(-1)).toBe(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));

    handle.kill();
    expect(ws.sent.at(-1)).toBe(JSON.stringify({ type: "signal", signal: "SIGTERM" }));

    handle.kill("SIGINT");
    expect(ws.sent.at(-1)).toBe(JSON.stringify({ type: "signal", signal: "SIGINT" }));
  });

  it("rejects create when the socket closes before opening", async () => {
    const { conn } = connWith("https://sbx.example", { fail: true });
    await expect(conn.pty.create()).rejects.toThrow(/closed before it opened/);
  });

  it("throws a clear error when no WebSocket is available", () => {
    const conn = new SandboxConnection({
      connectUrl: "https://sbx.example",
      apiKey: "k",
      dispatch: async () => new Response(),
    });
    const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
    try {
      expect(() => conn.openPtySocket(new URLSearchParams())).toThrow(/No WebSocket available/);
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = saved;
    }
  });
});
