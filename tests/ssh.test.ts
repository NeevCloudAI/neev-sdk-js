import net from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  SandboxConnection,
  type SandboxWebSocket,
  type WebSocketFactory,
  openSshTunnel,
} from "../src/index.js";

// EchoWS is a scriptable SandboxWebSocket that echoes every send back as a binary
// message, so a byte written into the tunnel comes back out. It opens on the next
// microtask by default; pass autoOpen:false to open it manually via fireOpen().
class EchoWS implements SandboxWebSocket {
  binaryType = "";
  url = "";
  headers: Record<string, string> = {};
  private listeners = new Map<string, ((ev: unknown) => void)[]>();
  private opened = false;

  constructor(autoOpen = true) {
    if (autoOpen) queueMicrotask(() => this.fireOpen());
  }
  fireOpen(): void {
    if (this.opened) return;
    this.opened = true;
    this.emit("open");
  }
  addEventListener(type: string, listener: (ev: unknown) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }
  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    // Copy to a standalone ArrayBuffer and echo it back as an arraybuffer message.
    const copy = toBytes(data).slice();
    queueMicrotask(() => this.emit("message", { data: copy.buffer }));
  }
  close(): void {
    this.emit("close");
  }
  private emit(type: string, ev?: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }
}

// toBytes normalizes a WebSocket send payload to a Uint8Array.
function toBytes(data: string | ArrayBufferLike | ArrayBufferView): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  const view = data as ArrayBufferView;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

// connWithEcho builds a SandboxConnection whose SSH sockets are captured EchoWS
// instances, exposing the last-created socket and the url/headers it was dialed with.
function connWithEcho(connectUrl: string, opts: { autoOpen?: boolean } = {}) {
  let last: EchoWS | undefined;
  const captured: { url?: string; headers?: Record<string, string> } = {};
  const factory: WebSocketFactory = (url, options) => {
    const ws = new EchoWS(opts.autoOpen ?? true);
    ws.url = url;
    ws.headers = options.headers;
    last = ws;
    captured.url = url;
    captured.headers = options.headers;
    return ws;
  };
  const conn = new SandboxConnection({
    connectUrl,
    apiKey: "k",
    dispatch: async () => new Response(),
    webSocket: factory,
  });
  return { conn, captured, getWS: () => last };
}

// roundTrip connects to the tunnel, writes msg, and resolves with the bytes echoed back.
function roundTrip(port: number, msg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.connect(port, "127.0.0.1", () => client.write(msg));
    let buf = "";
    client.on("data", (chunk) => {
      buf += chunk.toString();
      if (buf.length >= msg.length) {
        client.end();
        resolve(buf);
      }
    });
    client.on("error", reject);
  });
}

// connectOnce resolves if the port accepts a connection, rejects otherwise.
function connectOnce(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = net.connect(port, "127.0.0.1", () => {
      client.end();
      resolve();
    });
    client.on("error", reject);
  });
}

describe("ssh tunnel", () => {
  it("binds an ephemeral loopback port by default", async () => {
    const { conn } = connWithEcho("https://sbx.example");
    const tunnel = await openSshTunnel(conn);
    expect(tunnel.host).toBe("127.0.0.1");
    expect(tunnel.port).toBeGreaterThan(0);
    await tunnel.close();
  });

  it("forwards bytes both ways through the tunnel", async () => {
    const { conn } = connWithEcho("https://sbx.example");
    const tunnel = await openSshTunnel(conn);
    expect(await roundTrip(tunnel.port, "hello ssh")).toBe("hello ssh");
    await tunnel.close();
  });

  it("dials wss /v1/ssh with the bearer auth header", async () => {
    const { conn, captured } = connWithEcho("https://sbx.example");
    const tunnel = await openSshTunnel(conn);
    await roundTrip(tunnel.port, "x");
    expect(captured.url).toBe("wss://sbx.example/v1/ssh");
    expect(captured.headers?.authorization).toBe("Bearer k");
    await tunnel.close();
  });

  it("maps an http connect_url to ws", async () => {
    const { conn, captured } = connWithEcho("http://sbx.example");
    const tunnel = await openSshTunnel(conn);
    await roundTrip(tunnel.port, "x");
    expect(captured.url).toBe("ws://sbx.example/v1/ssh");
    await tunnel.close();
  });

  it("buffers bytes that arrive before the socket opens, then flushes on open", async () => {
    const { conn, getWS } = connWithEcho("https://sbx.example", { autoOpen: false });
    const tunnel = await openSshTunnel(conn);
    const echoed = roundTrip(tunnel.port, "early");
    // The socket for this connection is created synchronously on accept; wait for it,
    // give the pre-open write a tick to buffer, then open so the buffer flushes.
    await vi.waitFor(() => expect(getWS()).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    getWS()?.fireOpen();
    expect(await echoed).toBe("early");
    await tunnel.close();
  });

  it("close() stops the listener and is idempotent", async () => {
    const { conn } = connWithEcho("https://sbx.example");
    const tunnel = await openSshTunnel(conn);
    const port = tunnel.port;
    await tunnel.close();
    await tunnel.close();
    await expect(connectOnce(port)).rejects.toThrow();
  });

  it("drops a connection whose socket factory throws, without crashing", async () => {
    const factory: WebSocketFactory = () => {
      throw new Error("boom");
    };
    const conn = new SandboxConnection({
      connectUrl: "https://sbx.example",
      apiKey: "k",
      dispatch: async () => new Response(),
      webSocket: factory,
    });
    const tunnel = await openSshTunnel(conn);
    // The factory throws inside the accept callback; the process must survive and
    // the offending connection must be dropped.
    await new Promise<void>((resolve) => {
      const client = net.connect(tunnel.port, "127.0.0.1");
      client.on("close", () => resolve());
      client.on("error", () => resolve());
    });
    await tunnel.close();
  });
});
