---
"@neevcloud/sdk": minor
---

Add an interactive PTY surface: `sandbox.pty`.

Open a pseudo-terminal in a sandbox over a WebSocket — for shells, REPLs, and anything that needs a TTY.

- `sandbox.pty.create({ cols?, rows?, program?, args?, onData? })` resolves to a `PtyHandle` once connected. Terminal output streams to `onData` as `Uint8Array`.
- `PtyHandle`: `sendInput(string | Uint8Array)`, `resize(cols, rows)`, `kill(signal?)` (by name, default `SIGTERM`), `wait()` → `{ exitCode }`, and `disconnect()`. Also available on a raw `SandboxConnection` via `connection.pty`.
- New `webSocket` client option (`new Neev({ webSocket })`): the SDK uses the runtime's global `WebSocket` if present; in Node, pass a header-capable one (e.g. the `ws` package) so the auth header is sent.
- Exports `SandboxPty`, `PtyHandle`, and the `PtyCreateOptions` / `PtyResult` / `WebSocketFactory` / `SandboxWebSocket` types.
