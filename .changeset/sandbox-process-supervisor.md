---
"@neevcloud/sdk": minor
---

Add a sandbox process-supervisor surface: `sandbox.processes`.

Run **detached** processes whose lifetime outlives the request that started them, each addressed by a stable `process_id`.

- `sandbox.processes.start(command, options?)` returns a `Process` handle with `id`, `state`, `exitCode`, `startedAt`, and `status()`, `wait()` (blocks until exit), `kill(signal?)`, `logs({ cursor? })` (poll), and `follow({ cursor? })` (stream until exit).
- Collection ops on `sandbox.processes`: `get(id, { wait? })`, `list()`, `kill(id, signal?)`, `killAll(signal?)`, `logs(id, options?)`, `follow(id, options?)`. Also available on a raw `SandboxConnection` via `connection.processes`.
- Exports `SandboxProcesses`, `Process`, the `Signal` const (`{ HUP, INT, QUIT, KILL, TERM }`), and the `ProcessState` / `ProcessStatus` / `ProcessInfo` / `ProcessLogEntry` / `ProcessLogsPage` / `ProcessLogEvent` types plus the supporting option types.

Output is captured in a bounded ring: `logs` returns plain-text entries plus a monotonic cursor (with `dropped` when the ring rolled past it); `follow` streams decoded `stdout`/`stderr` chunks and a terminal `exit` event, and ends without an `exit` event on a caller abort. Like `files`/`exec`, the first call waits until the sandbox is Ready to resolve its `connect_url`.
