import type { AddressInfo, Server, Socket } from "node:net";
import { NeevError } from "./errors.js";
import type { SandboxWebSocket } from "./pty.js";
import type { SandboxConnection } from "./runtime.js";

// Options for opening an SSH tunnel to a sandbox.
export interface SshTunnelOptions {
  // Local TCP port to bind; 0 or omitted picks a free ephemeral port.
  port?: number;
  // Local address to bind; defaults to 127.0.0.1, so the listener is loopback-only.
  host?: string;
}

// A running SSH tunnel: a local TCP listener that forwards each accepted connection
// to the sandbox's SSH endpoint over an authenticated WebSocket. Point any ssh client
// or IDE at { host, port } — there are no keys to manage and no public port. Call
// close() to stop the listener and drop in-flight connections.
export interface SshTunnel {
  host: string;
  port: number;
  // Stops the listener and tears down live connections. Idempotent.
  close(): Promise<void>;
}

// Opens a local SSH tunnel to the sandbox. Binds a loopback TCP listener and, for
// each accepted connection, opens a WebSocket to the sandbox SSH endpoint and copies
// bytes both ways as binary frames. Node only — it needs a local TCP listener, which
// a browser cannot provide. Resolves once the listener is bound.
export async function openSshTunnel(
  conn: SandboxConnection,
  options: SshTunnelOptions = {},
): Promise<SshTunnel> {
  // node:net is imported on demand so this module stays loadable where it is absent
  // (browser bundles); SSH tunnelling is Node-only by nature.
  let net: typeof import("node:net");
  try {
    net = await import("node:net");
  } catch {
    throw new NeevError("SSH tunnelling is only available in Node (it requires node:net).");
  }

  // Resolve the WebSocket implementation once, up front, so a missing `ws` package
  // fails here rather than silently dropping every connection the listener accepts.
  const openSocket = await conn.sshSocketOpener();

  const host = options.host ?? "127.0.0.1";
  const live = new Set<Socket>();
  const server: Server = net.createServer((socket) => {
    live.add(socket);
    socket.once("close", () => live.delete(socket));
    // A throwing socket factory (e.g. a misconfigured `webSocket`) must drop just
    // this connection, not crash the process out of the accept callback.
    try {
      bridge(openSocket, socket);
    } catch {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) =>
      reject(new NeevError(`ssh tunnel failed to listen: ${err.message}`));
    server.once("error", onError);
    server.listen(options.port ?? 0, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  // After a successful listen, swallow late accept-time errors (e.g. EMFILE): an
  // unhandled 'error' event would otherwise crash the host process. A bind-time
  // failure is still surfaced by the listen promise above; close() tears down cleanly.
  server.on("error", () => {});

  const address = server.address() as AddressInfo;
  let closed = false;
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      if (closed) return resolve();
      closed = true;
      // Drop live connections first so server.close resolves promptly instead of
      // waiting on open sockets.
      for (const socket of live) socket.destroy();
      server.close(() => resolve());
    });

  return { host: address.address, port: address.port, close };
}

// bridge copies bytes between one accepted TCP connection and a fresh sandbox SSH
// WebSocket: socket data → binary frames, frames → socket. Bytes that arrive before
// the socket finishes opening are buffered and flushed on open. Either side closing
// ends the other.
function bridge(openSocket: () => SandboxWebSocket, socket: Socket): void {
  const ws = openSocket();
  ws.binaryType = "arraybuffer";
  let open = false;
  const pending: Uint8Array[] = [];

  ws.addEventListener("open", () => {
    open = true;
    for (const chunk of pending) ws.send(chunk);
    pending.length = 0;
  });
  ws.addEventListener("message", (event) => {
    const bytes = asBytes(event.data);
    if (bytes) socket.write(bytes);
  });
  ws.addEventListener("close", () => socket.end());
  ws.addEventListener("error", () => socket.destroy());

  socket.on("data", (chunk: Buffer) => {
    if (open) ws.send(chunk);
    else pending.push(chunk);
  });
  socket.on("close", () => ws.close());
  socket.on("error", () => ws.close());
}

// asBytes returns the bytes of a WebSocket message payload, or null for a text frame
// the SSH stream never uses.
function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}
