# Changelog

## 0.6.1-beta

### Minor Changes

- c757f8e: Add an interactive PTY surface: `sandbox.pty`.

  Open a pseudo-terminal in a sandbox over a WebSocket — for shells, REPLs, and anything that needs a TTY.

  - `sandbox.pty.create({ cols?, rows?, program?, args?, onData? })` resolves to a `PtyHandle` once connected. Terminal output streams to `onData` as `Uint8Array`.
  - `PtyHandle`: `sendInput(string | Uint8Array)`, `resize(cols, rows)`, `kill(signal?)` (by name, default `SIGTERM`), `wait()` → `{ exitCode }`, and `disconnect()`. Also available on a raw `SandboxConnection` via `connection.pty`.
  - New `webSocket` client option (`new Neev({ webSocket })`): the SDK uses the runtime's global `WebSocket` if present; in Node, pass a header-capable one (e.g. the `ws` package) so the auth header is sent.
  - Exports `SandboxPty`, `PtyHandle`, and the `PtyCreateOptions` / `PtyResult` / `WebSocketFactory` / `SandboxWebSocket` types.

- 2b3cd1a: Add a snapshot readiness wait so you no longer hand-write a poll loop. `neev.sandboxes.waitForSnapshot(snapshotId)` resolves once a snapshot reaches `Ready` (and throws with the error message if it fails or the wait times out), and `sandbox.snapshot({ waitUntilReady: true })` captures and waits in one call.

### Patch Changes

- Publish the newest beta as the default install. While the SDK is pre-1.0 and ships only on the beta line, each release now takes the npm `latest` dist-tag (a prerelease is also tagged `beta`), so `npm install @neevcloud/sdk` resolves to the newest build instead of a stale earlier version.

## 0.6.0-beta

### Minor Changes

- d6fef41: Add an agent lifecycle surface: `neev.agents` and `neev.agentTemplates`.

  Provision a packaged agent from a catalogue template onto its own backing sandbox (1:1), then manage it through a handle.

  - `neev.agents` — `create(params, scope?)`, `list(params?)` (paginated), `get(id, scope?)`, `update(id, params, scope?)` (in-place egress and cpu/memory; disk is not resizable), `pause(id, scope?)`, `resume(id, scope?)`, `delete(id, scope?)`. Every method returns an `Agent` handle (or a page of handles).
  - `Agent` handle — `id`, `name`, `status`, `templateId`, `sandboxId`, `config`, `data`/`toJSON()`, plus `refresh()`, `update()`, `pause()`, `resume()`, `delete()`, and `waitUntilReady()` (polls until `Ready`; fails fast on `Failed` and on `Paused`). `agent.sandbox()` resolves the backing sandbox as a `Sandbox` handle so callers can reach its `files`/`exec`/`processes`.
  - `neev.agentTemplates` — read-only catalogue: `list()` (paginated) and `get(id)`. The template `name` (e.g. `claude-code`) is passed as `agent_template` at create.
  - Exports `Agent`, the `AgentWaitOptions` / `AgentPage` / `ListAgentsParams` / `AgentTemplatePage` / `ListAgentTemplatesParams` option types, and the `AgentData` / `AgentStatus` / `CreateAgentParams` / `UpdateAgentParams` / `AgentListResponse` / `AgentTemplate` / `AgentTemplateListResponse` types.

- c26f452: Add a sandbox process-supervisor surface: `sandbox.processes`.

  Run **detached** processes whose lifetime outlives the request that started them, each addressed by a stable `process_id`.

  - `sandbox.processes.start(command, options?)` returns a `Process` handle with `id`, `state`, `exitCode`, `startedAt`, and `status()`, `wait()` (blocks until exit), `kill(signal?)`, `logs({ cursor? })` (poll), and `follow({ cursor? })` (stream until exit).
  - Collection ops on `sandbox.processes`: `get(id, { wait? })`, `list()`, `kill(id, signal?)`, `killAll(signal?)`, `logs(id, options?)`, `follow(id, options?)`. Also available on a raw `SandboxConnection` via `connection.processes`.
  - Exports `SandboxProcesses`, `Process`, the `Signal` const (`{ HUP, INT, QUIT, KILL, TERM }`), and the `ProcessState` / `ProcessStatus` / `ProcessInfo` / `ProcessLogEntry` / `ProcessLogsPage` / `ProcessLogEvent` types plus the supporting option types.

  Output is captured in a bounded ring: `logs` returns plain-text entries plus a monotonic cursor (with `dropped` when the ring rolled past it); `follow` streams decoded `stdout`/`stderr` chunks and a terminal `exit` event, and ends without an `exit` event on a caller abort. Like `files`/`exec`, the first call waits until the sandbox is Ready to resolve its `connect_url`.

## 0.5.0-beta

### Minor Changes

- d1d510f: Add sandbox snapshots, fork, restore, and a unified `exec`.

  - **Snapshots / fork / restore**: `sandboxes.createSnapshot` / `listSnapshots` (paginated) / `getSnapshot` / `deleteSnapshot`, `sandboxes.restore` (in place from a chosen snapshot), and `sandboxes.fork` (a new sandbox from the source's current live state — it does not reuse an existing snapshot), with matching `sandbox.snapshot` / `snapshots` / `restore` / `fork` handle methods. Exports `SnapshotData`, `SnapshotStatus`, `CreateSnapshotParams`, `SnapshotListResponse`.
  - **Unified exec**: `sandbox.exec` is buffered by default and returns a live event stream when called with `{ stream: true }` (typed via overloads). `sandbox.execStream` remains as a deprecated alias.

- d1d510f: Sync the sandbox lifecycle surface to the current aiagent API and add the sandbox-template catalogue.

  - `neev.templates` — new read-only resource: `list()` and `get(id)` over `/api/v1beta1/sandbox-templates`.
  - `sandboxes.create` takes an optional `sandbox_template_id`; when omitted the server uses its default template (and resolves the image and default command from the chosen template). `image`/`command` are optional and ignored when a template is set. **Breaking** for callers that passed only `image`.
  - `CreateSandboxRequest` and `Sandbox` gain `resources` (cpu/memory_gb/disk_gb) and `egress` (mode + allow rules); `Sandbox` also gains `sandbox_template_id` and `created_by`. The removed `namespace`/`fqdn`/`k8s_uid` fields are no longer returned.
  - `Sandbox` handle exposes `region`, `templateId`, and `resources`.
  - `Sandbox` handle now resolves the daemon `connect_url` automatically: `files`/`exec` wait until the sandbox is Ready on first use to obtain it, cache the connection, and rebuild it if the `connect_url` changes (e.g. across a resume).

- d1d510f: Add streaming command execution. `sandbox.execStream(command, options)` (also on `SandboxConnection`) is an async generator that yields `stdout`/`stderr` text chunks as the daemon flushes them and a terminal `exit` event, so callers can consume output live instead of waiting for the whole command. Buffered `sandbox.exec` is now implemented on top of it (unchanged behavior). Exports the `ExecStreamEvent` type.

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial SDK scaffold: `Neev` client with env/option config resolution.
- `neev.sandboxes` resource — `create`, `list`, `get`, `pause`, `resume`, `delete`, `metrics`.
- `Sandbox` handle with `refresh`, `pause`, `resume`, `delete`, `metrics`, and `waitUntilReady`.
- Typed error hierarchy (`NeevError` and HTTP-status subclasses).
- HTTP transport with timeout and exponential-backoff retries on network errors, `429`, and `5xx`.
- Generated TypeScript types from the AI Agent Service OpenAPI spec.
- Sandbox files: `sandbox.files.write()` writes files to a running sandbox via
  its runtime (reached at `connect_url`; not retried).
- Sandbox files: `sandbox.files.read()` (raw `Uint8Array`) and
  `sandbox.files.readText()` (UTF-8) read files from a running sandbox.
- Sandbox files: `sandbox.files.list()` lists directory entries
  (`FileEntry[]`) from a running sandbox.
- Sandbox exec: `sandbox.exec()` runs a command in a running sandbox and returns
  buffered `{ stdout, stderr, exitCode }` (drains the `/v1/exec` NDJSON stream;
  non-zero exit is not an error).

### Changed

- Hybrid autogen architecture: a shared `dispatch` transport backs both a typed
  `openapi-fetch` client (`createTypedClient`) for spec-backed services and a
  `RawClient` (`raw.request`) escape hatch for endpoints without a spec yet.
- `pnpm gen` now generates per-service types (`specs/<service>.yaml` →
  `src/generated/<service>.ts`) so specs can be migrated one at a time.

[Unreleased]: https://github.com/NeevCloudAI/neev-sdk-js/commits/main
