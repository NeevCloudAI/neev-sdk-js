# Neev JavaScript/TypeScript SDK — API Inventory

Complete, hand-maintained inventory of the public `@neevcloud/sdk` package: per-method reference, type field tables, symbol index, and contract notes. Use this document when you need exhaustive detail on the entire SDK surface.

Everything is `async`: methods return `Promise<...>` and are used with `await`. Install with `npm install @neevcloud/sdk@beta` and import from the package root:

```ts
import { Neev } from "@neevcloud/sdk";
```

## Table of contents

**Getting started**

- [Top-level exports](#top-level-exports)
- [Client](#client)

**Resources** — client-level API

- [Sandboxes resource](#sandboxes-resource) — create, list, get, pause, resume, keepalive, updateTimeout, delete, metrics, snapshots, rollback, fork, connect
- [Templates resource](#templates-resource)
- [Agents resource](#agents-resource) — create, list, get, update, pause, resume, delete
- [Agent templates resource](#agent-templates-resource)
- [Agent handle](#agent-handle)

**Working with a sandbox** — the `Sandbox` handle and its facades

- [Sandbox handle](#sandbox-handle)
- [Exec and streaming](#exec-and-streaming)
- [Files API](#files-api) — write, read, list, stat, exists, mkdir, move, remove, watch
- [Processes API](#processes-api)
- [PTY API](#pty-api)
- [SSH API](#ssh-api)
- [Runtime connection](#runtime-connection)

**Reference**

- [Raw client](#raw-client)
- [Types reference](#types-reference)
- [Errors](#errors)
- [Pagination types](#pagination-types)
- [Symbol index by module](#symbol-index-by-module)
- [Contract notes](#contract-notes)
- [Maintaining this inventory](#maintaining-this-inventory)

---

## Top-level exports

Everything re-exported from `@neevcloud/sdk` (`src/index.ts`). Values are exported with `export`; types are exported with `export type` and exist only at compile time.

| Symbol | Kind | Module |
| ------ | ---- | ------ |
| `Neev` | class | `client.ts` |
| `NeevOptions` | interface (type) | `client.ts` |
| `Scope` | interface (type) | `client.ts` |
| `RawClient` | class | `http.ts` |
| `FetchLike` | type alias | `http.ts` |
| `RawRequest` | interface (type) | `http.ts` |
| `Sandbox` | class | `sandbox.ts` |
| `WaitOptions` | interface (type) | `sandbox.ts` |
| `SnapshotWaitOptions` | interface (type) | `sandbox.ts` |
| `Agent` | class | `agent.ts` |
| `AgentWaitOptions` | interface (type) | `agent.ts` |
| `SandboxConnection` | class | `runtime.ts` |
| `SandboxFiles` | class | `runtime.ts` |
| `SandboxProcesses` | class | `processes.ts` |
| `Process` | class | `processes.ts` |
| `Signal` | const (value) | `processes.ts` |
| `ProcessState` | type alias (union) | `processes.ts` |
| `ProcessStatus` | interface (type) | `processes.ts` |
| `ProcessInfo` | interface (type) | `processes.ts` |
| `ProcessLogEntry` | interface (type) | `processes.ts` |
| `ProcessLogsPage` | interface (type) | `processes.ts` |
| `ProcessLogEvent` | type alias (union) | `processes.ts` |
| `StartProcessOptions` | interface (type) | `processes.ts` |
| `ProcessStatusOptions` | interface (type) | `processes.ts` |
| `ProcessLogsOptions` | interface (type) | `processes.ts` |
| `ProcessRequestOptions` | interface (type) | `processes.ts` |
| `SandboxPty` | class | `pty.ts` |
| `PtyHandle` | class | `pty.ts` |
| `PtyCreateOptions` | interface (type) | `pty.ts` |
| `PtyResult` | interface (type) | `pty.ts` |
| `WebSocketFactory` | type alias | `pty.ts` |
| `SandboxWebSocket` | interface (type) | `pty.ts` |
| `openSshTunnel` | function | `ssh.ts` |
| `SshTunnel` | interface (type) | `ssh.ts` |
| `SshTunnelOptions` | interface (type) | `ssh.ts` |
| `ExecOptions` | interface (type) | `runtime.ts` |
| `ExecResult` | interface (type) | `runtime.ts` |
| `ExecStreamEvent` | type alias (union) | `runtime.ts` |
| `FileEntry` | interface (type) | `runtime.ts` |
| `ListFilesOptions` | interface (type) | `runtime.ts` |
| `ReadFileOptions` | interface (type) | `runtime.ts` |
| `WriteFileOptions` | interface (type) | `runtime.ts` |
| `WriteFileResult` | interface (type) | `runtime.ts` |
| `ListSandboxesParams` | interface (type) | `resources/sandboxes.ts` |
| `MetricsParams` | interface (type) | `resources/sandboxes.ts` |
| `MetricsQuery` | interface (type) | `resources/sandboxes.ts` |
| `SandboxPage` | interface (type) | `resources/sandboxes.ts` |
| `WaitForSnapshotParams` | interface (type) | `resources/sandboxes.ts` |
| `ListTemplatesParams` | interface (type) | `resources/templates.ts` |
| `SandboxTemplatePage` | interface (type) | `resources/templates.ts` |
| `ListAgentsParams` | interface (type) | `resources/agents.ts` |
| `AgentPage` | interface (type) | `resources/agents.ts` |
| `ListAgentTemplatesParams` | interface (type) | `resources/agent-templates.ts` |
| `AgentTemplatePage` | interface (type) | `resources/agent-templates.ts` |
| `CreateAgentParams` | type alias | `types.ts` |
| `UpdateAgentParams` | type alias | `types.ts` |
| `AgentData` | type alias | `types.ts` |
| `AgentStatus` | type alias | `types.ts` |
| `AgentListResponse` | type alias | `types.ts` |
| `AgentTemplate` | type alias | `types.ts` |
| `AgentTemplateListResponse` | type alias | `types.ts` |
| `CreateSandboxParams` | type alias | `types.ts` |
| `OnIdleAction` | type alias | `types.ts` |
| `SandboxLifecycle` | type alias | `types.ts` |
| `UpdateTimeoutParams` | type alias | `types.ts` |
| `CreateSnapshotParams` | type alias | `types.ts` |
| `EgressConvenience` | interface (type) | `types.ts` |
| `EnvVar` | type alias | `types.ts` |
| `MetricSeries` | type alias | `types.ts` |
| `SandboxData` | type alias | `types.ts` |
| `SandboxEgressConfig` | type alias | `types.ts` |
| `SandboxEgressRule` | type alias | `types.ts` |
| `SandboxListResponse` | type alias | `types.ts` |
| `SandboxMetricsResponse` | type alias | `types.ts` |
| `SandboxPhase` | type alias | `types.ts` |
| `SandboxResources` | type alias | `types.ts` |
| `SandboxTemplate` | type alias | `types.ts` |
| `SandboxTemplateCategory` | type alias | `types.ts` |
| `SandboxTemplateListResponse` | type alias | `types.ts` |
| `SandboxTemplateStatus` | type alias | `types.ts` |
| `SnapshotData` | type alias | `types.ts` |
| `SnapshotListResponse` | type alias | `types.ts` |
| `SnapshotStatus` | type alias | `types.ts` |
| `NeevError` … `InternalServerError` | classes | `errors.ts` |
| `ApiErrorBody` | interface (type) | `errors.ts` |

> Note: `ListSnapshotsParams` and `SnapshotPage` are declared and `export`ed in `resources/sandboxes.ts` and are the return/param types of `listSnapshots` / `Sandbox.snapshots`, but they are not re-exported from the package root in `index.ts`. They are documented below alongside the methods that use them.

---

## Client

### `new Neev(options?)`

```ts
constructor(options?: NeevOptions)
```

The platform client. Construct once and reuse. Exposes two resource namespaces plus an untyped escape hatch:

- `client.sandboxes` — sandbox lifecycle operations (`Sandboxes`)
- `client.templates` — read-only template catalogue (`SandboxTemplates`)
- `client.agents` — agent lifecycle operations (`Agents`)
- `client.agentTemplates` — read-only agent-template catalogue (`AgentTemplates`)
- `client.raw` — untyped lifecycle HTTP escape hatch (`RawClient`)

**Parameters (`NeevOptions`, all optional):**

| Name | Type | Default | Description |
| ---- | ---- | ------- | ----------- |
| `apiKey` | `string` | `NEEV_API_KEY` env | Bearer API key. **Required** (constructor throws if absent). |
| `orgId` | `string` | `NEEV_ORG_ID` env | Default organization id. |
| `projectId` | `string` | `NEEV_PROJECT_ID` env | Default project id. |
| `baseURL` | `string` | `https://api.ai.neevcloud.com/agent` | Lifecycle base URL. |
| `timeoutMs` | `number` | `60000` | Per-request timeout in milliseconds. |
| `maxRetries` | `number` | `2` | Retries on transient failures (network errors, 429, 5xx). Sandbox runtime calls always use 0 retries because exec/write are not idempotent. |
| `fetch` | `FetchLike` | runtime global `fetch` | Custom fetch implementation. |

**Raises:**

- `NeevError` if no `apiKey` is provided (and `NEEV_API_KEY` is unset).
- `NeevError` if no global `fetch` exists and none is passed (use Node 18+, Bun, Deno, or pass `fetch`).

There is no `close()` — the client holds no persistent connections, so no teardown is required.

```ts
import { Neev } from "@neevcloud/sdk";

const client = new Neev({
  apiKey: process.env.NEEV_API_KEY,
  orgId: "org-123",
  projectId: "proj-456",
});
```

### Scope resolution

Every sandbox resource method accepts an optional per-call `scope` (`{ orgId?, projectId? }`) that overrides the client defaults. Org/project are resolved as: per-call override → constructor option → `NEEV_ORG_ID` / `NEEV_PROJECT_ID` env. If either is unresolved, the method throws `NeevError` **before** any HTTP request is sent. Templates are platform-managed and take no scope.

---

## Sandboxes resource

Access via `client.sandboxes` (a `Sandboxes` instance). Every lifecycle method returns a `Sandbox` handle (or a page of handles) so calls can be chained. All methods are `async`.

### `client.sandboxes.create(params, scope?)`

```ts
create(params: CreateSandboxParams, scope?: Scope): Promise<Sandbox>
```

Creates a new sandbox in the resolved org/project. The returned handle may still be in the `Pending` phase — call `waitUntilReady()` to block until it is `Ready`.

**Parameters:**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `params` | `CreateSandboxParams` | Create body. All fields optional; the platform generates a name when omitted and defaults the template. |
| `scope` | `Scope` (optional) | Per-call org/project override. |

**Returns:** `Promise<Sandbox>` — a handle with the initial lifecycle state (typically `phase === "Pending"` immediately after create).

**Raises:** `NeevError` (missing scope), `BadRequestError` (400), `AuthenticationError` (401), `PermissionDeniedError` (403), `ConflictError` (409), `RateLimitError` (429), `InternalServerError` (5xx), `APIConnectionError` / `APITimeoutError` on transport failure.

```ts
// Minimal: no fields — the platform generates a name and defaults the template.
const sandbox = await client.sandboxes.create({});
await sandbox.waitUntilReady();

// Explicit template and environment.
const configured = await client.sandboxes.create({
  sandbox_template_id: "sb-ubuntu-26-04-minimal",
  env: [{ name: "LOG_LEVEL", value: "debug" }],
});
```

### `client.sandboxes.list(params?)`

```ts
list(params?: ListSandboxesParams): Promise<SandboxPage>
```

Lists sandboxes in the resolved org/project with server-side pagination, returning wrapped handles.

**Parameters (`ListSandboxesParams`, extends `Scope`):**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `page` | `number` (optional) | 1-based page number. |
| `limit` | `number` (optional) | Page size. |
| `name` | `string` (optional) | Case-insensitive substring match on the sandbox name. |
| `status` | `SandboxPhase` (optional) | Exact lifecycle-phase match. |
| `sandboxId` | `string` (optional) | Narrow to a single sandbox by its id. |
| `orgId` / `projectId` | `string` (optional) | Per-call scope override. |

The filters combine with AND; each is omitted from the request when unset.

**Returns:** `Promise<SandboxPage>` with `{ items: Sandbox[]; total; page; limit }`. Each item is a `Sandbox` handle bound to the client.

**Raises:** `NeevError`, `AuthenticationError`, `PermissionDeniedError`, `RateLimitError`, `InternalServerError`, transport errors.

```ts
const page = await client.sandboxes.list({ page: 1, limit: 20 });
for (const sb of page.items) {
  console.log(sb.id, sb.name, sb.phase, sb.replicas);
}
console.log(`Showing ${page.items.length} of ${page.total}`);

// Filter by name substring and lifecycle phase.
const pausedWeb = await client.sandboxes.list({ name: "web", status: "Paused" });
```

### `client.sandboxes.get(id, scope?)`

```ts
get(id: string, scope?: Scope): Promise<Sandbox>
```

Fetches a single sandbox by id.

**Returns:** `Promise<Sandbox>`.

**Raises:** `NotFoundError` (404) if the sandbox does not exist, plus the usual scope/auth/transport errors.

```ts
const sandbox = await client.sandboxes.get("550e8400-e29b-41d4-a716-446655440000");
console.log(sandbox.phase, sandbox.connectUrl);
```

### `client.sandboxes.pause(id, scope?)`

```ts
pause(id: string, scope?: Scope): Promise<Sandbox>
```

Pauses a sandbox by scaling it to zero replicas. The lifecycle phase moves toward `Paused`.

**Returns:** `Promise<Sandbox>` — the updated handle (not `void`).

**Raises:** `NotFoundError`, plus scope/auth/transport errors.

```ts
const paused = await client.sandboxes.pause(sandbox.id);
console.log(paused.replicas); // 0
```

A paused sandbox will not become `Ready` until `resume()` is called. Calling `waitUntilReady()` on a `Paused` handle throws `NeevError`.

### `client.sandboxes.resume(id, scope?)`

```ts
resume(id: string, scope?: Scope): Promise<Sandbox>
```

Resumes a paused sandbox by scaling it back to one replica, moving it toward `Ready`.

**Returns:** `Promise<Sandbox>` — the updated handle.

**Raises:** `NotFoundError`, plus scope/auth/transport errors.

```ts
const resumed = await client.sandboxes.resume(sandbox.id);
await resumed.waitUntilReady();
```

### `client.sandboxes.keepalive(id, scope?)`

```ts
keepalive(id: string, scope?: Scope): Promise<Sandbox>
```

Resets the sandbox's idle timer (POST `.../keepalive`, no body), keeping a busy sandbox alive without an open connection. Call it periodically while work is in progress — e.g. once per agent turn. A loop of calls holds the sandbox past its original idle deadline.

**Returns:** `Promise<Sandbox>` — the updated handle (its `idle_expires_at` moves forward).

**Raises:** `NotFoundError`, plus scope/auth/transport errors.

```ts
await client.sandboxes.keepalive(sandbox.id);
```

### `client.sandboxes.updateTimeout(id, windows, scope?)`

```ts
updateTimeout(id: string, windows: UpdateTimeoutParams, scope?: Scope): Promise<Sandbox>
```

Changes the sandbox's idle/lifetime windows in place (PUT `.../timeout`). `UpdateTimeoutParams` = `{ idle_timeout_seconds?, max_lifetime_seconds?, paused_retention_seconds?: number | null; on_idle?: OnIdleAction }`. Durations are in **seconds**. Only the fields passed change: send `0` to turn a window off (no limit), an omitted field is left unchanged. An out-of-enum `on_idle` throws `NeevError` **before** the request is sent.

**Returns:** `Promise<Sandbox>` — the updated handle.

**Raises:** `NeevError` (bad `on_idle`, locally), `NotFoundError`, plus scope/auth/transport errors.

```ts
await client.sandboxes.updateTimeout(sandbox.id, { idle_timeout_seconds: 600, on_idle: "pause" });
await client.sandboxes.updateTimeout(sandbox.id, { max_lifetime_seconds: 0 }); // turn the window off
```

### `client.sandboxes.delete(id, scope?)`

```ts
delete(id: string, scope?: Scope): Promise<void>
```

Permanently deletes a sandbox.

**Returns:** `Promise<void>`.

**Raises:** `NotFoundError`, plus scope/auth/transport errors.

```ts
await client.sandboxes.delete(sandbox.id);
// or via handle:
await sandbox.delete();
```

### `client.sandboxes.metrics(id, params?)`

```ts
metrics(id: string, params?: MetricsParams): Promise<SandboxMetricsResponse>
```

Reads the live, tenant-scoped metric series for a sandbox over a time window.

**Parameters (`MetricsParams`, extends `Scope` and `MetricsQuery`):**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `from` | `string` (optional) | Window start (RFC3339). Defaults to one hour before `to`. |
| `to` | `string` (optional) | Window end (RFC3339). Defaults to now. |
| `step` | `string` (optional) | Resolution as a Go duration (e.g. `"60s"`, `"5m"`). Server clamps to a sane range. |
| `orgId` / `projectId` | `string` (optional) | Per-call scope override. |

**Returns:** `Promise<SandboxMetricsResponse>` with a `series: MetricSeries[]`.

**Raises:** `NotFoundError`, plus scope/auth/transport errors.

```ts
const metrics = await client.sandboxes.metrics(sandbox.id, {
  from: "2026-06-01T00:00:00Z",
  to: "2026-06-01T01:00:00Z",
  step: "1m",
});
for (const s of metrics.series) {
  console.log(s.metric, s.unit);
}
```

### `client.sandboxes.createSnapshot(id, params?, scope?)`

```ts
createSnapshot(id: string, params?: CreateSnapshotParams, scope?: Scope): Promise<SnapshotData>
```

Captures a filesystem snapshot of a sandbox. Returns immediately with `status === "Pending"`; poll `getSnapshot` until the status is `Ready` before restoring or forking from it.

**Parameters:**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `id` | `string` | Sandbox id to snapshot. |
| `params` | `CreateSnapshotParams` (optional) | Optional `name` and other snapshot-create fields (`include_memory` is excluded — see below). |
| `scope` | `Scope` (optional) | Per-call scope override. |

The SDK always forces `include_memory: false` on the wire (memory capture is unsupported), regardless of `params`.

**Returns:** `Promise<SnapshotData>` — typically with `status: "Pending"`.

**Raises:** `NotFoundError`, `BadRequestError`, `ConflictError`, plus scope/auth/transport errors.

```ts
const pending = await client.sandboxes.createSnapshot(sandbox.id, { name: "demo-snap" });
// or via handle:
const pending2 = await sandbox.snapshot({ name: "demo-snap" });
```

### `client.sandboxes.listSnapshots(id, params?)`

```ts
listSnapshots(id: string, params?: ListSnapshotsParams): Promise<SnapshotPage>
```

Lists the snapshots taken from a sandbox. **The endpoint is paginated** — the result carries `total` / `page` / `limit` and accepts `page` / `limit`, so callers can page through every snapshot rather than silently getting only the first page.

**Parameters (`ListSnapshotsParams`, extends `Scope`):**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `page` | `number` (optional) | 1-based page number. |
| `limit` | `number` (optional) | Page size. |
| `orgId` / `projectId` | `string` (optional) | Per-call scope override. |

**Returns:** `Promise<SnapshotPage>` with `{ items: SnapshotData[]; total; page; limit }`.

**Raises:** `NotFoundError`, plus scope/auth/transport errors.

```ts
const snaps = await client.sandboxes.listSnapshots(sandbox.id, { page: 1, limit: 50 });
console.log(`${snaps.items.length} of ${snaps.total} snapshots`);
// or via handle:
const snaps2 = await sandbox.snapshots();
```

### `client.sandboxes.getSnapshot(snapshotId, scope?)`

```ts
getSnapshot(snapshotId: string, scope?: Scope): Promise<SnapshotData>
```

Fetches a snapshot's metadata by id (project-scoped, not tied to its source sandbox). Use this to poll snapshot status after `createSnapshot`.

**Returns:** `Promise<SnapshotData>`.

**Raises:** `NotFoundError` if the snapshot does not exist, plus scope/auth/transport errors.

```ts
const snap = await client.sandboxes.getSnapshot(pending.id);
if (snap.status === "Ready") {
  // safe to roll back to or fork-from this snapshot
}
// To poll until Ready without hand-writing a loop, use waitForSnapshot below.
```

### `client.sandboxes.waitForSnapshot(snapshotId, params?)`

```ts
waitForSnapshot(snapshotId: string, params?: WaitForSnapshotParams): Promise<SnapshotData>
```

Polls `getSnapshot` until the snapshot reaches `Ready`, then resolves with it. Throws a `NeevError` if the snapshot enters `Failed` (surfacing its `error_message`) or if the wait budget elapses first. Use it after `createSnapshot` before `rollback` / `fork`, both of which require a `Ready` snapshot.

**Parameters (`WaitForSnapshotParams`, extends `Scope`):**

| Field | Type | Description |
| --- | --- | --- |
| `timeoutMs` | `number` (optional) | Overall wait budget in milliseconds. Defaults to `300000`. |
| `pollIntervalMs` | `number` (optional) | Delay between status polls in milliseconds. Defaults to `2000`. |

**Returns:** `Promise<SnapshotData>` with `status === "Ready"`.

**Raises:** `NeevError` on a `Failed` snapshot, on timeout, or for a non-finite/non-positive `timeoutMs`/`pollIntervalMs`; plus scope/auth/transport errors.

```ts
const pending = await client.sandboxes.createSnapshot(sandbox.id, { name: "demo-snap" });
const snap = await client.sandboxes.waitForSnapshot(pending.id);
// snap.status === "Ready"

// Or capture and wait in one call from the handle:
const ready = await sandbox.snapshot({ name: "demo-snap", waitUntilReady: true });
```

### `client.sandboxes.deleteSnapshot(snapshotId, scope?)`

```ts
deleteSnapshot(snapshotId: string, scope?: Scope): Promise<void>
```

Deletes a snapshot and its stored blob.

**Returns:** `Promise<void>`.

**Raises:** `NotFoundError`, plus scope/auth/transport errors.

```ts
await client.sandboxes.deleteSnapshot(snap.id);
```

### `client.sandboxes.rollback(id, snapshotId, scope?)`

```ts
rollback(id: string, snapshotId: string, scope?: Scope): Promise<Sandbox>
```

Rolls a sandbox back **in place** to one of its snapshots, overwriting its filesystem with the snapshot contents. The snapshot must belong to a sandbox in the same project, and must be `Ready`.

**Returns:** `Promise<Sandbox>` — the updated handle.

**Raises:** `NotFoundError`, `PreconditionFailedError` (e.g. snapshot not yet `Ready`), `ConflictError`, plus scope/auth/transport errors.

```ts
const rolledBack = await client.sandboxes.rollback(sandbox.id, snap.id);
// or via handle (updates state in place):
await sandbox.rollback(snap.id);
```

### `client.sandboxes.fork(id, name, scope?)`

```ts
fork(id: string, name: string, scope?: Scope): Promise<Sandbox>
```

Forks a sandbox into a **new** named sandbox. The server atomically snapshots the source's **current live state** and seeds the new sandbox from it; the source keeps running. This always forks the current state — it does **not** reuse a previously created snapshot (use `rollback` for a chosen snapshot).

**Parameters:**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `id` | `string` | Source sandbox id. |
| `name` | `string` | Name for the new forked sandbox. |
| `scope` | `Scope` (optional) | Per-call scope override. |

**Returns:** `Promise<Sandbox>` — a handle to the new sandbox.

**Raises:** `NotFoundError`, `ConflictError` (name collision), `BadRequestError`, plus scope/auth/transport errors.

```ts
const fork = await client.sandboxes.fork(sandbox.id, "fork-name");
await fork.waitUntilReady();
// or via handle:
const fork2 = await sandbox.fork("fork-name");
```

### `client.sandboxes.connect(connectUrl)`

```ts
connect(connectUrl: string): SandboxConnection
```

Opens a low-level runtime connection to the sandbox runtime at the given `connect_url`, backed by the client's bearer auth and the no-retry transport. Used internally by the `Sandbox` handle to back `sandbox.files` / `sandbox.exec`; exposed for advanced use. Synchronous (returns a `SandboxConnection`, not a `Promise`).

```ts
const conn = client.sandboxes.connect(sandbox.connectUrl!);
const result = await conn.exec(["uname", "-a"]);
```

---

## Templates resource

Access via `client.templates` (a `SandboxTemplates` instance). Read-only catalogue, platform-managed, with no org/project scope. A template id (e.g. `"sb-ubuntu-26-04-minimal"`) can be passed as `sandbox_template_id` to `sandboxes.create`.

### `client.templates.list(params?)`

```ts
list(params?: ListTemplatesParams): Promise<SandboxTemplatePage>
```

Lists the available sandbox templates. Only active and deprecated templates are returned by the server.

**Parameters (`ListTemplatesParams`):**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `page` | `number` (optional) | 1-based page number. |
| `limit` | `number` (optional) | Page size. |

**Returns:** `Promise<SandboxTemplatePage>` with `{ items: SandboxTemplate[]; total; page; limit }`.

**Raises:** `AuthenticationError`, `RateLimitError`, `InternalServerError`, transport errors.

```ts
const page = await client.templates.list({ limit: 10 });
for (const tmpl of page.items) {
  console.log(tmpl.id, tmpl.name, tmpl.category, tmpl.status);
}
```

### `client.templates.get(id)`

```ts
get(id: string): Promise<SandboxTemplate>
```

Fetches a single sandbox template by id.

**Returns:** `Promise<SandboxTemplate>`.

**Raises:** `NotFoundError` if the template id is unknown, plus auth/transport errors.

```ts
const tmpl = await client.templates.get("sb-ubuntu-26-04-minimal");
console.log(tmpl.description);
```

---

## Agents resource

Access via `client.agents` (an `Agents` instance). An agent is a managed workload that runs on its own 1:1 backing sandbox; the handle's `sandbox()` resolves that sandbox for runtime access (files/exec/PTY/SSH). Lifecycle mirrors the sandboxes resource.

### `client.agents.create(params, scope?)`

```ts
create(params: CreateAgentParams, scope?: Scope): Promise<Agent>
```

Creates an agent from a catalogue template. `name` and `agent_template` are required. Egress is deny-all by default; open it with the `allowInternet` / `allowEgress` convenience fields (see `EgressConvenience`) or a full `egress` object.

**Returns:** `Promise<Agent>` — the handle may still be `Provisioning`; call `waitUntilReady`.

**Raises:** `BadRequestError` (invalid template/config/egress), plus auth/transport errors.

```ts
const agent = await client.agents.create({
  name: "coder",
  agent_template: "claude-code",
  allowInternet: true,
});
await agent.waitUntilReady();
```

### `client.agents.list(params?)`

```ts
list(params?: ListAgentsParams): Promise<AgentPage>
```

Lists agents in the resolved org/project. `params` = `{ page?, limit?, orgId?, projectId? }`; returns `AgentPage` = `{ items: Agent[]; total; page; limit }`.

### `client.agents.get(id, scope?)`

```ts
get(id: string, scope?: Scope): Promise<Agent>
```

Fetches a single agent by id (a UUID, from `agents.list`).

### `client.agents.update(id, params, scope?)`

```ts
update(id: string, params: UpdateAgentParams, scope?: Scope): Promise<Agent>
```

Updates an agent in place. `UpdateAgentParams` = `{ egress?: SandboxEgressConfig; resources?: SandboxResources }`; at least one field is required. `resources` resizes `cpu` / `memory_gb` in place (`disk_gb` is fixed at creation) — see [Agent resources](#agent-resources) for defaults and bounds.

### `client.agents.pause(id, scope?)` / `resume(id, scope?)` / `delete(id, scope?)`

```ts
pause(id: string, scope?: Scope): Promise<Agent>
resume(id: string, scope?: Scope): Promise<Agent>
delete(id: string, scope?: Scope): Promise<void>
```

Pause suspends the backing sandbox; resume restarts it; delete removes the agent (resolves to `void`).

---

## Agent templates resource

Access via `client.agentTemplates` (an `AgentTemplates` instance). Read-only catalogue of agent templates (the template names passed to `agents.create`), platform-managed, with no org/project scope.

### `client.agentTemplates.list(params?)`

```ts
list(params?: ListAgentTemplatesParams): Promise<AgentTemplatePage>
```

Lists available agent templates. `params` = `{ page?, limit? }`; returns `AgentTemplatePage` = `{ items: AgentTemplate[]; total; page; limit }`.

### `client.agentTemplates.get(id)`

```ts
get(id: string): Promise<AgentTemplate>
```

Fetches a single agent template by id (e.g. `"ag-claude-code"`).

---

## Agent handle

`Agent` instances are returned by `agents.create()`, `get()`, `update()`, `pause()`, `resume()`, and `list().items`. They hold the latest known server state (`AgentData`) and expose lifecycle actions plus `sandbox()` to reach the backing sandbox's runtime. Construct via the `agents` resource, never directly.

### Getters

| Getter | Type | Description |
| ------ | ---- | ----------- |
| `id` | `string` | Agent id (UUID). |
| `name` | `string` | Agent name. |
| `status` | `AgentStatus` | Lifecycle status. |
| `templateId` | `string` | Agent template id it was created from. |
| `sandboxId` | `string` | Id of the 1:1 backing sandbox. |
| `config` | `Record<string, unknown> \| undefined` | Effective config (template defaults merged with create-time overrides). |
| `data` | `AgentData` | Raw server record. |

### Methods

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `sandbox()` | `Promise<Sandbox>` | Resolves the backing sandbox handle for files/exec/PTY/SSH. |
| `refresh()` | `Promise<this>` | Re-fetches the latest server state. |
| `update(params)` | `Promise<this>` | Updates in place (`UpdateAgentParams`), refreshing the handle. |
| `pause()` / `resume()` | `Promise<this>` | Suspend / restart the backing sandbox. |
| `delete()` | `Promise<void>` | Deletes the agent. |
| `waitUntilReady(options?)` | `Promise<this>` | Polls until the status is Ready. `options` = `{ timeoutMs?; pollIntervalMs? }`. |
| `toJSON()` | `AgentData` | The raw server record (for `JSON.stringify`). |

```ts
const agent = await client.agents.get(id);
await agent.waitUntilReady();
const box = await agent.sandbox(); // reach the runtime
await box.exec("echo", { args: ["hi"] });
```

---

## Sandbox handle

Returned by `create()`, `get()`, `list().items`, `pause()`, `resume()`, `rollback()`, and `fork()`. Holds the latest known server state (`SandboxData`) and offers lifecycle actions on this sandbox in place. Construct via the `sandboxes` resource rather than directly.

### Getters

| Getter | Type | Description |
| ------ | ---- | ----------- |
| `id` | `string` | Sandbox UUID. |
| `name` | `string` | Human-readable name. |
| `phase` | `SandboxPhase` | Current lifecycle phase as last seen from the server. |
| `replicas` | `number` | Desired replica count (`0` when paused, `1` when running). |
| `connectUrl` | `string \| null` | Runtime URL, or `null` when not yet configured. |
| `region` | `string` | Region slug the sandbox runs in. |
| `templateId` | `string \| null` | Catalogue template id it was created from, or `null` when unknown. |
| `resources` | `SandboxResources \| undefined` | Compute size, or `undefined` when defaulted. |
| `files` | `SandboxFiles` | Filesystem facade; resolves its connection lazily on first use (waits for Ready). |
| `processes` | `SandboxProcesses` | Process-supervisor facade; resolves its connection lazily on first use (waits for Ready). |
| `pty` | `SandboxPty` | Interactive-terminal facade; resolves its connection lazily on first use (waits for Ready). |
| `data` | `SandboxData` | The full raw API record. |

### `sandbox.refresh()`

```ts
refresh(): Promise<this>
```

Re-fetches the sandbox from the lifecycle and updates this handle's state in place.

**Returns:** `Promise<this>`.

```ts
await sandbox.refresh();
console.log(sandbox.phase, sandbox.replicas);
```

### `sandbox.waitUntilReady(options?)`

```ts
waitUntilReady(options?: WaitOptions): Promise<this>
```

Polls `refresh()` until `phase === "Ready"`, then resolves with this handle.

**Parameters (`WaitOptions`):**

| Name | Type | Default | Description |
| ---- | ---- | ------- | ----------- |
| `timeoutMs` | `number` | `120000` | Maximum time to wait for `Ready`. |
| `pollIntervalMs` | `number` | `2000` | Delay between status polls. |

**Returns:** `Promise<this>`.

**Raises:**

- `NeevError` if the sandbox is `Paused` (it will never become `Ready` on its own — call `resume()` first). Fails fast.
- `NeevError` if the timeout elapses before `Ready`.

```ts
await sandbox.waitUntilReady({ timeoutMs: 60_000, pollIntervalMs: 1_000 });
```

### `sandbox.pause()` / `sandbox.resume()` / `sandbox.delete()`

```ts
pause(): Promise<this>
resume(): Promise<this>
delete(): Promise<void>
```

Convenience wrappers that delegate to `client.sandboxes` using the handle's scope and update handle state in place (except `delete`, which removes the remote resource).

```ts
await sandbox.pause();   // replicas → 0
await sandbox.resume();  // replicas → 1, then:
await sandbox.waitUntilReady();
await sandbox.delete();
```

### `sandbox.keepalive()` / `sandbox.updateTimeout(windows)`

```ts
keepalive(): Promise<this>
updateTimeout(windows: UpdateTimeoutParams): Promise<this>
```

Delegate to `client.sandboxes.keepalive` / `updateTimeout` using the handle's scope and update handle state in place. `keepalive` resets the idle timer; `updateTimeout` changes the idle/lifetime windows (seconds — send `0` to turn a window off, omit to leave it unchanged). An out-of-enum `on_idle` throws `NeevError` before the request.

```ts
await sandbox.keepalive();
await sandbox.updateTimeout({ idle_timeout_seconds: 600, on_idle: "pause" });
```

### `sandbox.metrics(params?)`

```ts
metrics(params?: MetricsQuery): Promise<SandboxMetricsResponse>
```

Reads the live metric series for this sandbox. Same as `client.sandboxes.metrics(this.id, ...)` using the handle's scope. Accepts the `MetricsQuery` window (`from` / `to` / `step`).

```ts
const m = await sandbox.metrics({ step: "1m" });
```

### `sandbox.snapshot(params?)` / `sandbox.snapshots(params?)`

```ts
snapshot(options?: CreateSnapshotParams & SnapshotWaitOptions): Promise<SnapshotData>
snapshots(params?: ListSnapshotsParams): Promise<SnapshotPage>
```

Convenience wrappers for `createSnapshot` and `listSnapshots` on this sandbox. `snapshot` takes the snapshot-create fields (`name`, `retain_for`) plus `SnapshotWaitOptions` (`{ waitUntilReady?: boolean; timeoutMs?; pollIntervalMs? }`): by default it returns the `Pending` `SnapshotData`, but with `{ waitUntilReady: true }` it blocks (via `waitForSnapshot`) and resolves only once the snapshot is `Ready`. `snapshots` is **paginated** and returns a `SnapshotPage`.

```ts
const pending = await sandbox.snapshot({ name: "demo-snap" });                 // Pending
const ready = await sandbox.snapshot({ name: "demo-snap", waitUntilReady: true }); // Ready
const page = await sandbox.snapshots({ page: 1, limit: 50 });
```

### `sandbox.rollback(snapshotId)` / `sandbox.fork(name)`

```ts
rollback(snapshotId: string): Promise<this>
fork(name: string): Promise<Sandbox>
```

`rollback` delegates to `client.sandboxes.rollback`, rolling this sandbox back **in place** to the chosen snapshot and updating handle state in place; returns `this`. `fork` delegates to `client.sandboxes.fork`, forking this sandbox into a **new** sandbox seeded from its **current live state** (does not reuse an existing snapshot); returns a new `Sandbox` handle.

```ts
// In-place rollback to a chosen (Ready) snapshot — mutates this sandbox:
await sandbox.rollback(snap.id);

// Fork the current live state into a new sandbox:
const fork = await sandbox.fork("fork-name");
await fork.waitUntilReady();
```

### `sandbox.getUrl(options)`

```ts
getUrl(options: { port: number } & GetPortUrlOptions): Promise<string>
```

Exposes `options.port` for preview URLs and returns its public URL. The gateway route is not live the instant a port is exposed, so by default this polls the URL until it is routable before returning. `GetPortUrlOptions`: `waitUntilReady?` (default true), `timeoutMs?` (default 60000), `pollIntervalMs?` (default 2000).

**Returns:** `Promise<string>` — the preview URL.

```ts
await sandbox.processes.start(["busybox", "httpd", "-f", "-p", "3000"]);
const url = await sandbox.getUrl({ port: 3000 });
```

### `sandbox.exposePort(port)` / `listPorts()` / `revokePort(port)`

```ts
exposePort(port: number): Promise<SandboxPort>
listPorts(): Promise<SandboxPort[]>
revokePort(port: number): Promise<void>
```

Lower-level port control: `exposePort` exposes a port without the readiness wait (idempotent — re-exposing returns the same URL), `listPorts` returns the exposed ports, and `revokePort` stops serving one.

`SandboxPort`: `{ port: number; preview_url: string }`.

```ts
const ports = await sandbox.listPorts();
await sandbox.revokePort(3000);
```

### `sandbox.exec(...)` / `sandbox.execStream(...)`

See [Exec and streaming](#exec-and-streaming).

### `sandbox.toJSON()`

```ts
toJSON(): SandboxData
```

Returns the raw API record so `JSON.stringify(sandbox)` emits the API shape.

```ts
console.log(JSON.stringify(sandbox, null, 2));
```

---

## Exec and streaming

Runtime command execution runs against the sandbox runtime at `connect_url`. The `Sandbox` handle resolves the connection lazily: the first `exec` / `files` call waits until the sandbox is `Ready` (and has a `connect_url`) before issuing the request. A non-zero exit code is **not** an error — it is reported in the result (or the `exit` event), never thrown.

### `sandbox.exec(command, options?)`

Overloaded. Buffered by default; streams when `options.stream` is `true`.

```ts
// Buffered (default):
exec(command: string | string[], options?: ExecOptions): Promise<ExecResult>

// Streaming:
exec(command: string | string[], options: ExecOptions & { stream: true }): AsyncGenerator<ExecStreamEvent>
```

Runs a command in the sandbox. With no `stream` flag it buffers stdout/stderr and resolves to the full `ExecResult`. With `{ stream: true }` it returns a live async-iterable of `stdout` / `stderr` chunks followed by a terminal `exit` event.

**Parameters:**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `command` | `string \| string[]` | A bare program name (combine with `options.args`) or a full argv array. |
| `options` | `ExecOptions` (optional) | See `ExecOptions` below. |

`ExecOptions` fields: `args?: string[]`, `cwd?: string`, `env?: Record<string,string>`, `timeoutMs?: number`, `stdin?: string`, `signal?: AbortSignal`, `stream?: boolean`. Passing both an argv array `command` and a non-empty `options.args` throws `NeevError`.

**Returns:** `Promise<ExecResult>` (buffered) or `AsyncGenerator<ExecStreamEvent>` (streaming).

**Raises:** `NeevError` (invalid args, sandbox `Paused`/timeout on the readiness wait, or a stream that ends without an exit status), and typed `APIError` subclasses mapped from the sandbox.s `{reason_code, message}` (e.g. `PermissionDeniedError`, `BadRequestError`, `NotFoundError`, `PreconditionFailedError`, `RateLimitError`, `DeadlineExceededError`, `InternalServerError`).

```ts
// argv form (preferred)
const result = await sandbox.exec(["python3", "-c", "import sys; print(sys.version)"]);

// program + args form
const echo = await sandbox.exec("echo", { args: ["hello", "world"] });

// with env, cwd, timeout
const r = await sandbox.exec(["sh", "-c", "echo $MY_VAR > out.txt && cat out.txt"], {
  cwd: "workspace",
  env: { MY_VAR: "test-value" },
  timeoutMs: 30_000,
});

if (r.exitCode !== 0) console.error(`Command failed: ${r.stderr}`);
else console.log(r.stdout);

// streaming
for await (const event of sandbox.exec(["sh", "-c", "for i in 1 2 3; do echo line-$i; sleep 0.5; done"], { stream: true })) {
  if (event.type === "stdout") process.stdout.write(event.data);
  else if (event.type === "stderr") process.stderr.write(event.data);
  else console.log(`\nexited with code ${event.exitCode}`);
}
```

### `sandbox.execStream(command, options?)` — deprecated

```ts
/** @deprecated Use `exec(command, { stream: true })`. */
execStream(command: string | string[], options?: ExecOptions): AsyncGenerator<ExecStreamEvent>
```

Deprecated alias for the streaming form of `exec`. Identical behavior to `exec(command, { stream: true })`. Prefer the `{ stream: true }` form.

```ts
for await (const event of sandbox.execStream(["echo", "hi"])) {
  if (event.type === "stdout") process.stdout.write(event.data);
}
```

### `ExecStreamEvent` shapes

| `type` | Fields |
| ------ | ------ |
| `"stdout"` | `data: string` (decoded UTF-8 chunk) |
| `"stderr"` | `data: string` (decoded UTF-8 chunk) |
| `"exit"` | `exitCode: number` (terminal event) |

---

## Files API

Access via the `sandbox.files` getter (a `SandboxFiles`). The first call resolves the sandbox connection, waiting for the sandbox to be `Ready`. Paths are resolved against the sandbox workspace; an optional `cwd` is supplied for relative paths.

### `sandbox.files.write(path, content, options?)`

```ts
write(path: string, content: string | Uint8Array, options?: WriteFileOptions): Promise<WriteFileResult>
```

Writes string or binary content to a path in the sandbox.

**Parameters:** `path: string`; `content: string | Uint8Array`; `options.cwd?: string`; `options.signal?: AbortSignal`.

**Returns:** `Promise<WriteFileResult>` — `{ bytesWritten: number }`.

```ts
const info = await sandbox.files.write("src/main.py", 'print("hello")\n');
console.log(`Wrote ${info.bytesWritten} bytes`);
```

### `sandbox.files.read(path, options?)` / `readText(path, options?)`

```ts
read(path: string, options?: ReadFileOptions): Promise<Uint8Array>
readText(path: string, options?: ReadFileOptions): Promise<string>
```

`read` returns raw bytes (binary-safe). `readText` decodes the bytes as a UTF-8 string. `ReadFileOptions`: `cwd?`, `signal?`.

```ts
const raw = await sandbox.files.read("data.bin");
const text = await sandbox.files.readText("README.md");
```

### `sandbox.files.list(path, options?)`

```ts
list(path: string, options?: ListFilesOptions): Promise<FileEntry[]>
```

Lists directory entries at a path.

**Parameters (`ListFilesOptions`):** `cwd?: string`; `recursive?: boolean` (default false, server-side); `maxCount?: number`; `signal?: AbortSignal`.

**Returns:** `Promise<FileEntry[]>`.

```ts
const entries = await sandbox.files.list(".", { recursive: true });
for (const e of entries) {
  console.log(`${e.type.padEnd(10)} ${e.path} (${e.size} bytes)`);
}
```

### `sandbox.files.stat(path, options?)` / `exists(path, options?)`

```ts
stat(path: string, options?: FileOpOptions): Promise<FileEntry>
exists(path: string, options?: FileOpOptions): Promise<boolean>
```

`stat` returns metadata for a single entry; `exists` reports whether a path is present. `FileOpOptions`: `cwd?`, `signal?`.

```ts
if (await sandbox.files.exists("src/main.py")) {
  const info = await sandbox.files.stat("src/main.py");
  console.log(`${info.path} is ${info.size} bytes`);
}
```

### `sandbox.files.mkdir(path, options?)`

```ts
mkdir(path: string, options?: FileOpOptions): Promise<FileEntry>
```

Creates a directory, including any missing parent directories, and returns the created entry.

```ts
const dir = await sandbox.files.mkdir("out/logs");
```

### `sandbox.files.move(source, destination, options?)`

```ts
move(source: string, destination: string, options?: FileOpOptions): Promise<FileEntry>
```

Moves or renames an entry, returning the moved entry.

```ts
await sandbox.files.move("out/main.py", "out/app.py");
```

### `sandbox.files.remove(path, options?)`

```ts
remove(path: string, options?: RemoveFileOptions): Promise<void>
```

Deletes a file or directory. `RemoveFileOptions`: `cwd?`, `recursive?` (default false, server-side — required for a non-empty directory), `signal?`.

```ts
await sandbox.files.remove("out", { recursive: true });
```

### `sandbox.files.watch(path, options?)`

```ts
watch(path: string, options?: WatchFilesOptions): AsyncGenerator<WatchEvent>
```

Streams filesystem change events for a directory as they occur, yielding one `WatchEvent` per change. The stream ends when its timeout elapses, the abort signal fires, or the connection closes; a bad path is reported before the first event. `WatchFilesOptions`: `cwd?`, `recursive?`, `timeoutMs?`, `signal?`.

`WatchEvent`: `{ type: "create" | "write" | "remove" | "rename" | "chmod"; path: string; entry?: FileEntry }`.

```ts
for await (const ev of sandbox.files.watch(".", { recursive: true })) {
  console.log(`${ev.type} ${ev.path}`);
}
```

All file operations raise typed `APIError` subclasses (mapped from the sandbox.s reason codes) on failure, and `NeevError` if the readiness wait fails.

---

## Processes API

Access via the `sandbox.processes` getter (a `SandboxProcesses`). Runs **detached** processes whose lifetime is decoupled from the request that started them, each addressed by a stable `process_id`. The first call resolves the sandbox connection, waiting for the sandbox to be `Ready`. HTTP-backed failures raise typed `APIError` subclasses (e.g. `NotFoundError` for an unknown `process_id`, `BadRequestError` for a disallowed signal). Before any HTTP call, `start` throws `NeevError` for invalid arguments (an argv array combined with `args`, or an empty program), and the first-use readiness wait throws `NeevError` if the sandbox is `Paused` or does not become `Ready` in time.

### `sandbox.processes.start(command, options?)`

```ts
start(command: string | string[], options?: StartProcessOptions): Promise<Process>
```

Starts a detached process and returns a `Process` handle. `command` is a bare program (combine with `options.args`) or a full argv array; passing both throws `NeevError`.

**`StartProcessOptions`:** `args?: string[]`; `cwd?: string`; `env?: Record<string,string>` (sent as `K=V`); `stdin?: string`; `signal?: AbortSignal`.

### `sandbox.processes.get(id, options?)`

```ts
get(processId: string, options?: { wait?: boolean; signal?: AbortSignal }): Promise<ProcessStatus>
```

Returns a status snapshot. With `wait: true` it blocks until the process exits (bounded by the sandbox.s wait ceiling).

### `sandbox.processes.list(options?)`

```ts
list(options?: { signal?: AbortSignal }): Promise<ProcessInfo[]>
```

Lists all tracked processes (running plus recently-exited, retained ones).

### `sandbox.processes.kill(id, signal?)` / `killAll(signal?)`

```ts
kill(processId: string, signal?: number): Promise<boolean>
killAll(signal?: number): Promise<number>
```

`kill` signals one process and returns whether a signal was delivered (`false` if already exited); `killAll` signals every running process and returns the count. `signal` defaults to SIGTERM. Use the `Signal` const: `{ HUP: 1, INT: 2, QUIT: 3, KILL: 9, TERM: 15 }`.

### `sandbox.processes.logs(id, options?)` / `follow(id, options?)`

```ts
logs(processId: string, options?: { cursor?: number; signal?: AbortSignal }): Promise<ProcessLogsPage>
follow(processId: string, options?: { cursor?: number; signal?: AbortSignal }): AsyncGenerator<ProcessLogEvent>
```

`logs` polls captured output from `cursor` (0 = oldest retained byte) and returns `{ entries, cursor, dropped, state }` — `entries[].data` is plain UTF-8; `dropped: true` means the ring rolled past the cursor. `follow` streams `stdout`/`stderr` chunks (decoded) and a terminal `exit` event; a caller abort ends the stream **without** an exit event.

### `Process` handle

| Member | Type | Description |
| ------ | ---- | ----------- |
| `id` | `string` | The `process_id`. |
| `state` | `ProcessState` | Last-known state (`"running" \| "exited"`); updated by `status()`/`wait()`. |
| `exitCode` | `number \| null` | Last-known exit code; `null` while running. |
| `startedAt` | `number` | Spawn time, epoch milliseconds. |
| `status(options?)` | `Promise<ProcessStatus>` | Non-blocking refresh. |
| `wait(options?)` | `Promise<ProcessStatus>` | Blocks until exit; caches the terminal status. |
| `kill(signal?)` | `Promise<boolean>` | Signals this process. |
| `logs(options?)` | `Promise<ProcessLogsPage>` | Polls this process's output. |
| `follow(options?)` | `AsyncGenerator<ProcessLogEvent>` | Streams this process's output. |

**Type shapes:** `ProcessStatus` = `{ processId; state; exitCode: number\|null; startedAt }`; `ProcessInfo` = `ProcessStatus & { name; args: string[]; cwd }`; `ProcessLogEntry` = `{ stream: "stdout"\|"stderr"; data: string }`; `ProcessLogsPage` = `{ entries: ProcessLogEntry[]; cursor: number; dropped: boolean; state }`; `ProcessLogEvent` = `{ type: "stdout"\|"stderr"; data } | { type: "exit"; exitCode }`.

---

## PTY API

Access via the `sandbox.pty` getter (a `SandboxPty`). Opens an interactive pseudo-terminal over a WebSocket; the first call waits for the sandbox to be `Ready`.

### `sandbox.pty.create(options?)`

```ts
create(options?: PtyCreateOptions): Promise<PtyHandle>
```

Opens a PTY (or reattaches to an existing terminal with `id`) and resolves once connected. `PtyCreateOptions`: `id?: string` (reattach; the sandbox replays recent scrollback, and program/args/size are ignored), `program?: string`, `args?: string[]`, `cols?: number`, `rows?: number`, `onData?: (chunk: Uint8Array) => void`. Throws `NeevError` if no WebSocket is available.

### `PtyHandle`

| Member | Type | Description |
| ------ | ---- | ----------- |
| `id` | `string \| undefined` | Terminal id, for reattaching later with `create({ id })`. Set once connected. |
| `sendInput(data)` | `void` | Send `string \| Uint8Array` to the terminal's stdin. |
| `resize(cols, rows)` | `void` | Forward a window-size change. |
| `kill(signal?)` | `void` | Signal the process group by name (default `"SIGTERM"`). |
| `wait()` | `Promise<PtyResult>` | Resolves with `{ exitCode }` when the session ends. |
| `connected()` | `Promise<void>` | Resolves once the socket is open (awaited by `create`). |
| `disconnect()` | `void` | Close the socket; the terminal keeps running. `wait` then resolves. |

**Type shapes:** `PtyResult` = `{ exitCode: number }`; `WebSocketFactory` = `(url: string, options: { headers: Record<string,string> }) => SandboxWebSocket`; `SandboxWebSocket` is the minimal `binaryType`/`send`/`close`/`addEventListener` subset satisfied by the global `WebSocket` and Node's `ws`.

The WebSocket comes from the client's `webSocket` option, else the runtime global. In Node, pass a header-capable one (the global cannot send the auth header).

---

## SSH API

Access via `sandbox.ssh()`. Opens a local SSH tunnel — a loopback TCP listener that forwards each accepted connection to the sandbox over an authenticated WebSocket — so any ssh client, `scp`/`rsync`, or IDE remote-dev points at it with no keys to manage and no public port. The first call waits for the sandbox to be `Ready`. Node only: it opens a local TCP listener, which a browser cannot provide.

### `sandbox.ssh(options?)`

```ts
ssh(options?: SshTunnelOptions): Promise<SshTunnel>
```

Binds the listener and resolves once it is listening. `SshTunnelOptions`: `port?: number` (local port to bind; 0 or omitted picks a free ephemeral port), `host?: string` (local bind address; default `127.0.0.1`, loopback-only). Throws `NeevError` if `ws` is not installed and no `webSocket` factory is configured, or if the runtime has no `node:net`.

**Returns:** `Promise<SshTunnel>`.

`SshTunnel`: `{ host: string; port: number; close(): Promise<void> }`. `close()` stops the listener and drops in-flight connections; it is idempotent.

```ts
const tunnel = await sandbox.ssh();
console.log(`ssh -p ${tunnel.port} neev@localhost`);
await tunnel.close();
```

The WebSocket comes from the client's `webSocket` option, else the [`ws`](https://www.npmjs.com/package/ws) package loaded on demand — resolved once when the tunnel opens, so a missing install fails fast rather than dropping every connection. `openSshTunnel(connection, options?)` is exported for use with a low-level `SandboxConnection`.

---

## Runtime connection

Low-level connection to the sandbox runtime, reached directly at the sandbox's `connect_url`. Constructed internally by the `Sandbox` handle; exposed for advanced use via `client.sandboxes.connect(connectUrl)` or `new SandboxConnection(...)`.

### `new SandboxConnection(opts)`

```ts
constructor(opts: SandboxConnectionOptions)
```

`SandboxConnectionOptions`: `connectUrl: string`; `apiKey: string`; `dispatch: Dispatch` (the no-retry transport). When built via `client.sandboxes.connect`, these are supplied from the client.

| Member | Type | Description |
| ------ | ---- | ----------- |
| `files` | `SandboxFiles` | File operations bound to this connection. |
| `processes` | `SandboxProcesses` | Process-supervisor operations bound to this connection. |
| `pty` | `SandboxPty` | Interactive-terminal operations bound to this connection. |
| `exec(command, options?)` | `Promise<ExecResult>` | Buffered command execution. |
| `execStream(command, options?)` | `AsyncGenerator<ExecStreamEvent>` | Streaming command execution. |
| `request(req)` | `Promise<Response>` | Low-level runtime request; throws a typed `APIError` on non-2xx. |

Unlike `Sandbox.exec`, the connection-level `exec` and `execStream` are separate methods (there is no `{ stream: true }` flag here — `ExecOptions.stream` is ignored at this level). Neither waits for readiness; the caller is responsible for using a live `connect_url`.

```ts
import { SandboxConnection } from "@neevcloud/sdk";

const conn = client.sandboxes.connect(sandbox.connectUrl!);
const result = await conn.exec(["uname", "-a"]);
console.log(result.stdout);

await conn.files.write("notes.txt", "hello");
```

There is no `close()` — the connection holds no persistent socket.

---

## Raw client

Untyped escape hatch over the lifecycle transport for endpoints without an OpenAPI spec. Shares the same auth, timeout, retry, and error mapping as the typed resources. Access via `client.raw`.

### `client.raw.request<T>(req)`

```ts
request<T>(req: RawRequest): Promise<T>
```

Issues the request and returns the parsed JSON body typed as `T`. The caller supplies the response type parameter.

**Parameters (`RawRequest`):**

| Name | Type | Description |
| ---- | ---- | ----------- |
| `method` | `"GET" \| "POST" \| "PUT" \| "PATCH" \| "DELETE"` | HTTP method. |
| `path` | `string` | Path relative to the base URL (a leading `/` is added if absent; the base URL's path prefix is preserved). |
| `query` | `Record<string, string \| number \| undefined \| null>` (optional) | Query params; `null`/`undefined` entries are omitted. |
| `body` | `unknown` (optional) | JSON request body, serialized when present. |
| `signal` | `AbortSignal` (optional) | Caller cancellation, combined with the per-request timeout. |

**Returns:** `Promise<T>` — the parsed JSON body. An empty body (e.g. HTTP 204) resolves to `undefined`.

**Raises:** typed `APIError` subclass on non-2xx; `APIConnectionError` / `APITimeoutError` on transport failure.

```ts
// List templates via raw HTTP
const data = await client.raw.request<{ items: { id: string; name: string }[] }>({
  method: "GET",
  path: "/api/v1beta1/sandbox-templates",
  query: { limit: 5, page: 1 },
});
for (const item of data.items) console.log(item.name, item.id);
```

---

## Types reference

Import from `@neevcloud/sdk`. Most lifecycle types are aliases over the generated OpenAPI schema (`src/generated/aiagent.ts`); the runtime types are hand-written in `src/runtime.ts`. Field shapes below reflect those generated/hand-written definitions.

### `CreateSandboxParams`

The generated `CreateSandboxRequest` plus the SDK-only `EgressConvenience` fields. The request body for `sandboxes.create`. All fields are optional — the platform generates a name when omitted and defaults the template.

| Field | Type | Required |
| ----- | ---- | -------- |
| `name` | `string` (DNS-1123 label) | no (server-generated) |
| `sandbox_template_id` | `string` | no (platform default) — set this **or** `image` |
| `image` | `string` (OCI ref, tag/digest) | no — BYOI; set this **or** `sandbox_template_id` |
| `command` | `string[]` | no (BYOI start command override) |
| `lifecycle` | `SandboxLifecycle` | no (idle/lifetime windows; omitted → account defaults) |
| `env` | `EnvVar[]` | no |
| `resources` | `SandboxResources` | no |
| `egress` | `SandboxEgressConfig` | no |
| `allowInternet` | `boolean` | no (SDK convenience — opens all egress) |
| `allowEgress` | `string[]` | no (SDK convenience — allow specific hosts) |

### `OnIdleAction`

Alias for the generated `OnIdleAction` enum: `"pause" | "delete"` — what the platform does when a sandbox hits its idle window or max lifetime. The SDK rejects any other value locally (in `create` and `updateTimeout`) before sending.

### `SandboxLifecycle`

Alias for the generated `SandboxLifecycle` — the `lifecycle` block accepted by `sandboxes.create`. Durations in seconds; send `0` to turn a window off (no limit), or omit a field to use the account default.

| Field | Type | Required |
| ----- | ---- | -------- |
| `idle_timeout_seconds` | `number \| null` | no |
| `max_lifetime_seconds` | `number \| null` | no |
| `paused_retention_seconds` | `number \| null` | no |
| `on_idle` | `OnIdleAction` | no |

### `UpdateTimeoutParams`

Alias for the generated `UpdateSandboxTimeoutRequest` — the body for `sandboxes.updateTimeout` / `sandbox.updateTimeout`. Same shape as `SandboxLifecycle` (idle/lifetime windows in seconds; send `0` to turn one off, omit to leave unchanged).

> Exact optionality/extra fields follow the generated OpenAPI schema; consult `src/generated/aiagent.ts` if the spec changes.

### `SandboxData`

Alias for the generated `Sandbox` schema — the full lifecycle sandbox record wrapped by the `Sandbox` handle.

| Field | Type | Required |
| ----- | ---- | -------- |
| `id` | `string` | yes |
| `org_id` | `string` | yes |
| `project_id` | `string` | yes |
| `name` | `string` | yes |
| `region` | `string` | yes |
| `phase` | `SandboxPhase` | yes |
| `replicas` | `number` (0–1) | yes |
| `connect_url` | `string \| null` | no |
| `sandbox_template_id` | `string` | no |
| `resources` | `SandboxResources` | no |
| `env` | `EnvVar[]` | no |
| `egress` | `SandboxEgressConfig` | no |
| `created_at` | `string` | yes |
| `updated_at` | `string` | yes |

> The handle reads `id`, `name`, `phase`, `replicas`, `connect_url`, `region`, `sandbox_template_id`, and `resources` from this shape.

### `SandboxPhase`

Alias for the generated `SandboxPhase` enum — the lifecycle phase reported by the service. Steady states include `"Pending"`, `"Ready"`, `"NotReady"`, `"Unknown"`, and `"Paused"`; the lifecycle may also report transitional values during pause/resume transitions. `Sandbox.waitUntilReady` treats `"Ready"` as success and `"Paused"` as a fail-fast terminal state.

### `SandboxResources`

Compute size for a sandbox / agent (`cpu` / `memory_gb` / `disk_gb`, all optional). Omitted fields resolve according to the precedence below. Shape per the generated schema.

| Field | Type | Default | Range |
| ----- | ---- | ------- | ----- |
| `cpu` | `number` (vCPUs) | the platform assigns 1 vCPU | 0.5–8, in steps of 0.5 |
| `memory_gb` | `number` (GB) | the platform assigns 2 GB | 1–16 |
| `disk_gb` | `number` (GB) | the platform assigns 10 GB | 10–100, in steps of 10 |

Per-field resolution order for a **sandbox**: caller value → platform default (above). `sandbox_template_id` selects only the image, not resources — there is no sandbox-template resource layer. **Agents** insert a middle layer (the agent template's `default_resources`) — see [Agent resources](#agent-resources).

`cpu` and `memory_gb` are resizable in place via [`agents.update`](#clientagentsupdateid-params-scope) (resized on the running sandbox); `disk_gb` is fixed at creation and is rejected if `update` supplies a different value.

### Agent resources

An agent runs on a 1:1 backing sandbox, so **agent resources use the same `SandboxResources` shape and bounds** as sandboxes (above). On `agents.create`, the `resources` field sizes that backing sandbox. Each field resolves as: caller value → the **agent template's** `default_resources` (`AgentTemplate.default_resources`) → platform default. Because agent templates seed their own `default_resources`, an agent created without `resources` inherits the **template's** sizing, not the platform floor — every current platform template defaults to 2 vCPU / 4 GB / 20 GB (set per template, so treat this as the current value rather than a fixed guarantee).

`agents.update` resizes `cpu` / `memory_gb` in place on the running sandbox; `disk_gb` cannot be changed after creation.

### `SandboxEgressConfig` / `SandboxEgressRule`

`SandboxEgressConfig` — network egress policy (mode plus optional allow rules). `SandboxEgressRule` — a single egress allow rule (host plus optional ports/protocol). Shapes per the generated schema.

### `EgressConvenience`

SDK-only fields on `CreateSandboxParams` and `CreateAgentParams` that translate into `egress`: `allowInternet?: boolean` opens all egress (emits the `allow_internet` gate plus the `0.0.0.0/0` and `::/0` routes), `allowEgress?: string[]` allows specific hosts (FQDN or CIDR). An explicit `egress` takes precedence over both.

### `CreateAgentParams`

The generated `CreateAgentRequest` plus the SDK-only `EgressConvenience` fields. The request body for `agents.create`. `name` and `agent_template` are required.

| Field | Type | Required |
| ----- | ---- | -------- |
| `name` | `string` (DNS-1123 label) | yes |
| `agent_template` | `string` (catalogue name) | yes |
| `region` | `string` | no |
| `env` | `EnvVar[]` | no |
| `config` | `Record<string, unknown>` | no (template-specific overrides) |
| `resources` | `SandboxResources` | no |
| `egress` | `SandboxEgressConfig` | no |
| `allowInternet` | `boolean` | no (SDK convenience — opens all egress) |
| `allowEgress` | `string[]` | no (SDK convenience — allow specific hosts) |

### `UpdateAgentParams`

Alias for the generated `UpdateAgentRequest` — the body for `agents.update`. At least one field must be provided.

| Field | Type | Required |
| ----- | ---- | -------- |
| `egress` | `SandboxEgressConfig` | no |
| `resources` | `SandboxResources` | no |

### `AgentData`

Alias for the generated `Agent` schema — the full agent record wrapped by the `Agent` handle: `id`, `org_id`, `project_id`, `name`, `agent_template_id`, `sandbox_id` (the 1:1 backing sandbox), `drive_mode`, `status` (`AgentStatus`), `config?`, `metrics_url`, `web_ui_url?`, `gateway_token?`, `created_at`, `updated_at`.

### `AgentStatus`

Alias for the generated `AgentStatus` enum: `"Provisioning" | "Ready" | "Paused" | "Failed" | "Deleting"`. `Agent.waitUntilReady` treats `"Ready"` as success.

### `AgentTemplate` / `AgentTemplateListResponse`

`AgentTemplate` — a platform-managed agent template (id, name, description, etc.), the catalogue for `agents.create`. `AgentTemplateListResponse` — the paginated list payload from `agentTemplates.list`. Shapes per the generated schema.

### `EnvVar`

A single environment variable passed to a sandbox.

| Field | Type | Required |
| ----- | ---- | -------- |
| `name` | `string` | yes |
| `value` | `string` | yes |

### `SandboxListResponse`

Paginated list payload returned by `sandboxes.list` (before the SDK wraps items into handles).

| Field | Type |
| ----- | ---- |
| `items` | `SandboxData[]` |
| `total` | `number` |
| `page` | `number` |
| `limit` | `number` |

### `SandboxMetricsResponse` / `MetricSeries`

`SandboxMetricsResponse` — the metric series bundle returned by `sandboxes.metrics`, containing a `series: MetricSeries[]`. `MetricSeries` — one named time series within that response (`metric`, optional `unit`, and the data points). Exact field names follow the generated schema.

### `SandboxTemplate`

A platform-managed sandbox runtime template, referenced as `sandbox_template_id` at create time. Typically includes `id`, `name`, `description`, `category` (`SandboxTemplateCategory`), `status` (`SandboxTemplateStatus`), and timestamps. Shape per the generated schema.

### `SandboxTemplateCategory`

Catalogue category of a sandbox template: `"standard" | "browser"`.

### `SandboxTemplateStatus`

Lifecycle status of a sandbox template: `"active" | "deprecated" | "disabled"`.

### `SandboxTemplateListResponse`

Paginated list payload returned by `templates.list`.

| Field | Type |
| ----- | ---- |
| `items` | `SandboxTemplate[]` |
| `total` | `number` |
| `page` | `number` |
| `limit` | `number` |

### `SnapshotData`

Alias for the generated `Snapshot` schema — a snapshot captured from a sandbox's filesystem.

| Field | Type | Required |
| ----- | ---- | -------- |
| `id` | `string` | yes |
| `sandbox_id` | `string` | yes |
| `org_id` | `string` | yes |
| `project_id` | `string` | yes |
| `name` | `string` | no |
| `status` | `SnapshotStatus` | yes |
| `include_memory` | `boolean` | yes (always `false` from this SDK) |
| `created_at` | `string` | yes |
| `updated_at` | `string` | yes |

> Additional fields (size, source region, expiry, error message) may be present per the generated schema.

### `SnapshotStatus`

Lifecycle status of a snapshot: `"Pending" | "Running" | "Ready" | "Failed"`. A new snapshot starts `Pending` and must reach `Ready` before it can be used for `rollback` or fork-from. Poll via `getSnapshot`.

### `CreateSnapshotParams`

Caller-facing options for `sandbox.snapshot` / `sandboxes.createSnapshot`. Defined as the generated `CreateSnapshotRequest` with `include_memory` omitted — the SDK always sets `include_memory: false` on the wire, so callers cannot request memory capture.

| Field | Type | Required |
| ----- | ---- | -------- |
| `name` | `string` | no |

> Other non-`include_memory` fields of `CreateSnapshotRequest` (e.g. retention) are accepted per the generated schema.

### `SnapshotListResponse`

Paginated list payload returned by `sandboxes.listSnapshots` (before the SDK rewraps it into a `SnapshotPage`).

| Field | Type |
| ----- | ---- |
| `items` | `SnapshotData[]` |
| `total` | `number` |
| `page` | `number` |
| `limit` | `number` |

### `Scope`

| Field | Type |
| ----- | ---- |
| `orgId` | `string` (optional) |
| `projectId` | `string` (optional) |

### `ExecOptions`

Options for running a command (`sandbox.exec`, `SandboxConnection.exec`/`execStream`).

| Field | Type | Description |
| ----- | ---- | ----------- |
| `args` | `string[]` | Arguments when `command` is a bare program name. Ignored if `command` is already an argv array; combining a non-empty `args` with an argv array throws. |
| `cwd` | `string` | Working directory for the command. |
| `env` | `Record<string, string>` | Extra env vars, merged over the sandbox's environment. |
| `timeoutMs` | `number` | Wall-clock timeout; the server clamps to its ceiling. |
| `stdin` | `string` | Data piped to the command's stdin. |
| `signal` | `AbortSignal` | Caller cancellation. |
| `stream` | `boolean` | When true, `sandbox.exec` returns a stream instead of a buffered result. Ignored by `SandboxConnection` (which exposes `exec` vs `execStream` separately). |

### `ExecResult`

Buffered result of a command. A non-zero `exitCode` is **not** an error. `stdout`/`stderr` are UTF-8 decoded text (not binary-safe); output is captured in full.

| Field | Type |
| ----- | ---- |
| `stdout` | `string` |
| `stderr` | `string` |
| `exitCode` | `number` |

### `ExecStreamEvent`

```ts
type ExecStreamEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; exitCode: number };
```

### `FileEntry`

A single directory entry returned by `files.list`.

| Field | Type | Required |
| ----- | ---- | -------- |
| `name` | `string` | yes |
| `type` | `"file" \| "directory" \| "symlink"` | yes |
| `path` | `string` (relative to the workspace root) | yes |
| `size` | `number` | yes |
| `mode` | `number` (raw Unix mode bits) | yes |
| `permissions` | `string` (9-char rwx, e.g. `"rwxr-xr-x"`) | yes |
| `modifiedTime` | `string` (RFC3339) | yes |
| `symlinkTarget` | `string` | no (present for symlinks) |

### `WriteFileOptions` / `ReadFileOptions` / `ListFilesOptions` / `WriteFileResult`

| Type | Fields |
| ---- | ------ |
| `WriteFileOptions` | `cwd?: string`, `signal?: AbortSignal` |
| `ReadFileOptions` | `cwd?: string`, `signal?: AbortSignal` |
| `ListFilesOptions` | `cwd?: string`, `recursive?: boolean`, `maxCount?: number`, `signal?: AbortSignal` |
| `WriteFileResult` | `bytesWritten: number` |

### `WaitOptions`

| Field | Type | Default |
| ----- | ---- | ------- |
| `timeoutMs` | `number` | `120000` |
| `pollIntervalMs` | `number` | `2000` |

### `NeevOptions`

See [Client](#client) for the full table.

### `FetchLike` / `RawRequest` / `ApiErrorBody`

- `FetchLike` — `typeof fetch`; a fetch implementation compatible with the global `fetch`.
- `RawRequest` — see [Raw client](#raw-client).
- `ApiErrorBody` — the JSON error body shape: `{ error: string; details?: string }`.

---

## Errors

All SDK errors inherit from `NeevError`. Import from `@neevcloud/sdk`. Branch with `instanceof`.

| Class | When raised |
| ----- | ----------- |
| `NeevError` | Base class; thrown directly for client-side problems (missing API key, missing scope, invalid exec args, readiness timeout, `Paused` sandbox, exec stream ending without an exit). |
| `APIConnectionError` | Request never produced a response — DNS failure, connection reset, caller abort. |
| `APITimeoutError` | Request aborted because it exceeded the configured timeout (subclass of `APIConnectionError`). |
| `APIError` | Base for any non-2xx HTTP response. Carries `status`, `code`, `details`, `requestId`. |
| `BadRequestError` | HTTP 400 |
| `AuthenticationError` | HTTP 401 |
| `PermissionDeniedError` | HTTP 403 |
| `NotFoundError` | HTTP 404 |
| `ConflictError` | HTTP 409 |
| `PreconditionFailedError` | HTTP 412 |
| `RateLimitError` | HTTP 429 |
| `DeadlineExceededError` | HTTP 504 |
| `InternalServerError` | HTTP 5xx (default for any 500+ status not matched above) |

`APIError` properties: `status: number`, `code?: string` (from the body's `error` field), `details?: string` (from the body's `details` field), `requestId?: string` (from the `x-request-id` header).

Runtime exec/file errors are mapped to the same hierarchy via reason codes: `permission_denied` → 403, `invalid_argument` → 400, `not_found` → 404, `failed_precondition` → 412, `resource_exhausted` → 429, `deadline_exceeded` → 504, `unavailable` → 503, `internal` → 500.

```ts
import { Neev, NotFoundError, AuthenticationError, NeevError } from "@neevcloud/sdk";

try {
  const client = new Neev();
  await client.sandboxes.get("00000000-0000-0000-0000-000000000000");
} catch (e) {
  if (e instanceof NotFoundError) {
    console.error(`404 — code=${e.code}, request-id=${e.requestId}`);
  } else if (e instanceof AuthenticationError) {
    console.error("Check NEEV_API_KEY");
  } else if (e instanceof NeevError) {
    console.error(`SDK error: ${e.message}`);
  }
}
```

---

## Pagination types

`list()`-style methods return pages. `SandboxPage`, `SandboxTemplatePage`, `MetricsParams`, `MetricsQuery`, `ListSandboxesParams`, and `ListTemplatesParams` are re-exported from the package root. `ListSnapshotsParams` and `SnapshotPage` are exported from `resources/sandboxes.ts` but not from the package root (they are the param/return types of `listSnapshots` / `Sandbox.snapshots`).

### `SandboxPage`

| Field | Type |
| ----- | ---- |
| `items` | `Sandbox[]` (wrapped handles) |
| `total` | `number` |
| `page` | `number` |
| `limit` | `number` |

### `SandboxTemplatePage`

| Field | Type |
| ----- | ---- |
| `items` | `SandboxTemplate[]` |
| `total` | `number` |
| `page` | `number` |
| `limit` | `number` |

### `SnapshotPage`

| Field | Type |
| ----- | ---- |
| `items` | `SnapshotData[]` |
| `total` | `number` |
| `page` | `number` |
| `limit` | `number` |

### `ListSandboxesParams` / `ListSnapshotsParams`

Both extend `Scope` and add `page?: number`, `limit?: number`.

### `ListTemplatesParams`

`page?: number`, `limit?: number` (no scope — templates are platform-wide).

### `MetricsQuery` / `MetricsParams`

`MetricsQuery` — `from?: string`, `to?: string`, `step?: string`. `MetricsParams` — `MetricsQuery` plus `Scope` (`orgId?`, `projectId?`). The `Sandbox` handle's `metrics` takes `MetricsQuery` and supplies the scope itself.

---

## Symbol index by module

Compact reviewer index.

### Client (`client.ts`)

| Symbol | Kind | Description |
| ------ | ---- | ----------- |
| `Neev` | class | Platform client; exposes `.sandboxes`, `.templates`, `.agents`, `.agentTemplates`, `.raw`. |
| `Neev` constructor | method | `NeevOptions`: `apiKey`, `orgId`, `projectId`, `baseURL`, `timeoutMs`, `maxRetries`, `fetch`. |
| `Neev.createSandboxConnection` | method | `SandboxConnection` for a `connect_url` (internal use). |
| `NeevOptions` | type | Constructor options. |
| `Scope` | type | `{ orgId?, projectId? }`. |

### Sandboxes resource (`resources/sandboxes.ts`)

| Symbol | Kind | Returns |
| ------ | ---- | ------- |
| `Sandboxes.create` | method | `Promise<Sandbox>` |
| `Sandboxes.list` | method | `Promise<SandboxPage>` |
| `Sandboxes.get` | method | `Promise<Sandbox>` |
| `Sandboxes.pause` | method | `Promise<Sandbox>` |
| `Sandboxes.resume` | method | `Promise<Sandbox>` |
| `Sandboxes.keepalive` | method | `Promise<Sandbox>` |
| `Sandboxes.updateTimeout` | method | `Promise<Sandbox>` |
| `Sandboxes.delete` | method | `Promise<void>` |
| `Sandboxes.metrics` | method | `Promise<SandboxMetricsResponse>` |
| `Sandboxes.createSnapshot` | method | `Promise<SnapshotData>` (forces `include_memory: false`) |
| `Sandboxes.listSnapshots` | method | `Promise<SnapshotPage>` (paginated) |
| `Sandboxes.getSnapshot` | method | `Promise<SnapshotData>` |
| `Sandboxes.deleteSnapshot` | method | `Promise<void>` |
| `Sandboxes.rollback` | method | `Promise<Sandbox>` (in place) |
| `Sandboxes.fork` | method | `Promise<Sandbox>` (new sandbox from current live state) |
| `Sandboxes.connect` | method | `SandboxConnection` (sync) |
| `ListSandboxesParams`, `SandboxPage`, `ListSnapshotsParams`, `SnapshotPage`, `MetricsQuery`, `MetricsParams` | types | Params/return shapes. |

### Templates resource (`resources/templates.ts`)

| Symbol | Kind | Returns |
| ------ | ---- | ------- |
| `SandboxTemplates.list` | method | `Promise<SandboxTemplatePage>` |
| `SandboxTemplates.get` | method | `Promise<SandboxTemplate>` |
| `ListTemplatesParams`, `SandboxTemplatePage` | types | Params/return shapes. |

### Agents resource (`resources/agents.ts`)

| Symbol | Kind | Returns |
| ------ | ---- | ------- |
| `Agents.create` | method | `Promise<Agent>` |
| `Agents.list` | method | `Promise<AgentPage>` |
| `Agents.get` | method | `Promise<Agent>` |
| `Agents.update` | method | `Promise<Agent>` (in place) |
| `Agents.pause` / `resume` | methods | `Promise<Agent>` |
| `Agents.delete` | method | `Promise<void>` |
| `ListAgentsParams`, `AgentPage` | types | Params/return shapes. |

### Agent templates resource (`resources/agent-templates.ts`)

| Symbol | Kind | Returns |
| ------ | ---- | ------- |
| `AgentTemplates.list` | method | `Promise<AgentTemplatePage>` |
| `AgentTemplates.get` | method | `Promise<AgentTemplate>` |
| `ListAgentTemplatesParams`, `AgentTemplatePage` | types | Params/return shapes. |

### Agent handle (`agent.ts`)

| Symbol | Kind | Notes |
| ------ | ---- | ----- |
| `id`, `name`, `status`, `templateId`, `sandboxId`, `config`, `data` | getters | `config` is `Record<string, unknown> \| undefined`. |
| `sandbox` | method | `Promise<Sandbox>` (backing sandbox for runtime access). |
| `refresh` | method | `Promise<this>` |
| `update` | method | `Promise<this>`; `UpdateAgentParams`. |
| `pause` / `resume` | methods | `Promise<this>` |
| `delete` | method | `Promise<void>` |
| `waitUntilReady` | method | `Promise<this>`; `AgentWaitOptions`. |
| `toJSON` | method | `AgentData`. |

### Sandbox handle (`sandbox.ts`)

| Symbol | Kind | Notes |
| ------ | ---- | ----- |
| `id`, `name`, `phase`, `replicas`, `connectUrl`, `region`, `templateId`, `resources`, `data` | getters | `connectUrl` is `string \| null`. |
| `files` | getter | `SandboxFiles` (lazy connection). |
| `processes` | getter | `SandboxProcesses` (lazy connection). |
| `refresh` | method | `Promise<this>` |
| `waitUntilReady` | method | `Promise<this>`; `WaitOptions`. |
| `pause` / `resume` | methods | `Promise<this>` |
| `keepalive` | method | `Promise<this>` |
| `updateTimeout` | method | `Promise<this>`; `UpdateTimeoutParams`. |
| `delete` | method | `Promise<void>` |
| `metrics` | method | `Promise<SandboxMetricsResponse>` |
| `snapshot` | method | `Promise<SnapshotData>` |
| `snapshots` | method | `Promise<SnapshotPage>` (paginated) |
| `rollback` | method | `Promise<this>` (in place) |
| `fork` | method | `Promise<Sandbox>` |
| `exec` | method | `Promise<ExecResult>` or `AsyncGenerator<ExecStreamEvent>` (overloaded). |
| `execStream` | method | `AsyncGenerator<ExecStreamEvent>` — **deprecated** alias. |
| `toJSON` | method | `SandboxData` |
| `WaitOptions` | type | Wait config. |

### Runtime (`runtime.ts`)

| Symbol | Kind | Notes |
| ------ | ---- | ----- |
| `SandboxConnection` | class | `files`, `processes`, `exec`, `execStream`, `request`. |
| `SandboxConnection.exec` | method | `Promise<ExecResult>` |
| `SandboxConnection.execStream` | method | `AsyncGenerator<ExecStreamEvent>` |
| `SandboxFiles.write` | method | `Promise<WriteFileResult>` (`bytesWritten`). |
| `SandboxFiles.read` | method | `Promise<Uint8Array>` |
| `SandboxFiles.readText` | method | `Promise<string>` |
| `SandboxFiles.list` | method | `Promise<FileEntry[]>` |
| `ExecOptions`, `ExecResult`, `ExecStreamEvent`, `FileEntry`, `WriteFileOptions`, `ReadFileOptions`, `ListFilesOptions`, `WriteFileResult` | types | Runtime shapes. |

### Processes (`processes.ts`)

| Symbol | Kind | Notes |
| ------ | ---- | ----- |
| `SandboxProcesses` | class | `start`, `get`, `list`, `kill`, `killAll`, `logs`, `follow`. |
| `Process` | class | Handle: `id`, `state`, `exitCode`, `startedAt`, `status`, `wait`, `kill`, `logs`, `follow`. |
| `Signal` | const | `{ HUP: 1, INT: 2, QUIT: 3, KILL: 9, TERM: 15 }`. |
| `ProcessState`, `ProcessStatus`, `ProcessInfo`, `ProcessLogEntry`, `ProcessLogsPage`, `ProcessLogEvent` | types | Supervisor shapes. |
| `StartProcessOptions`, `ProcessStatusOptions`, `ProcessLogsOptions`, `ProcessRequestOptions` | types | Operation options. |

### PTY (`pty.ts`)

| Symbol | Kind | Notes |
| ------ | ---- | ----- |
| `SandboxPty` | class | `create` → `PtyHandle`. |
| `PtyHandle` | class | `id`, `sendInput`, `resize`, `kill`, `wait`, `connected`, `disconnect`. |
| `PtyCreateOptions`, `PtyResult` | types | Create options and exit result. |
| `WebSocketFactory`, `SandboxWebSocket` | types | Pluggable WebSocket transport. |

### SSH (`ssh.ts`)

| Symbol | Kind | Notes |
| ------ | ---- | ----- |
| `openSshTunnel` | function | Opens a local SSH tunnel to a sandbox connection. |
| `SshTunnel`, `SshTunnelOptions` | types | Tunnel handle (`host`/`port`/`close`) and open options (`port`/`host`). |

### HTTP / raw (`http.ts`)

| Symbol | Kind | Notes |
| ------ | ---- | ----- |
| `RawClient.request<T>` | method | Untyped lifecycle HTTP; `Promise<T>` (`undefined` on 204). |
| `FetchLike`, `RawRequest` | types | Transport and request shapes. |

### Errors (`errors.ts`)

| Symbol | Kind | Notes |
| ------ | ---- | ----- |
| `NeevError` | class | Base. |
| `APIConnectionError`, `APITimeoutError` | classes | Transport failures. |
| `APIError` + status subclasses | classes | Non-2xx HTTP. |
| `ApiErrorBody` | type | `{ error, details? }`. |

---

## Contract notes

- Client env vars: `NEEV_API_KEY`, `NEEV_ORG_ID`, `NEEV_PROJECT_ID` (not `NEEVAI_*`). The constructor throws `NeevError` if no API key resolves.
- `create` takes all-optional fields; the platform generates a name when omitted and defaults the template.
- `pause()` and `resume()` return the updated `Sandbox` handle (not `void`).
- `connectUrl` is a getter returning `string | null`, not a method.
- Snapshots start `Pending` and must reach `Ready` (poll `getSnapshot`) before `rollback` or fork-from.
- `rollback(id, snapshotId)` rolls a sandbox back **in place** to a chosen, `Ready` snapshot, overwriting the sandbox filesystem.
- `fork(id, name)` snapshots the **current live state** and seeds a **new** sandbox — it does **not** reuse an existing snapshot. Use `rollback` when you want a specific prior snapshot.
- `listSnapshots` / `Sandbox.snapshots` are **paginated**: they return `SnapshotPage` (`{ items, total, page, limit }`) and accept `{ page, limit }`. `SnapshotPage`/`ListSnapshotsParams` are not re-exported at the package root.
- `exec` is buffered by default; pass `{ stream: true }` for a live async-iterable. `execStream` is a **deprecated** alias for the streaming form.
- A non-zero exit code is reported (in `ExecResult.exitCode` or the `exit` event), never thrown. Runtime failure frames throw typed `APIError` subclasses.
- Sandbox runtime calls use a **no-retry** transport (exec/write are not idempotent); lifecycle calls retry network errors, 429, and 5xx up to `maxRetries` (default 2).
- `sandbox.exec` and `sandbox.files` wait for the sandbox to be `Ready` (and to expose a `connect_url`) on first use; `SandboxConnection` methods do not wait.
- There is no `close()` on `Neev` or `SandboxConnection` — neither holds a persistent connection.

---

## Maintaining this inventory

Update manually when the public API changes. Cross-check against `src/`:

- `src/index.ts` — the authoritative list of public exports.
- `src/client.ts`, `src/resources/*.ts`, `src/sandbox.ts`, `src/runtime.ts` — method signatures and behaviors.
- `src/types.ts` + `src/generated/aiagent.ts` — lifecycle type shapes (regenerate generated types from the spec, then verify the field tables here).
- `src/errors.ts` — the error hierarchy and status mapping.

---

I read all the source files and `/tmp/py-api-inventory.md`, then produced the complete, exact markdown above for `docs/api-inventory.md`. Key accuracy notes baked into the doc:

- Documented all exports from `src/index.ts` (values vs `export type`), including the package-root types and the fact that `ListSnapshotsParams`/`SnapshotPage` are exported from `resources/sandboxes.ts` but not re-exported at root.
- `Neev` constructor (`NeevOptions`) with real defaults (`baseURL` default `https://api.ai.neevcloud.com/agent`, `timeoutMs` 60000, `maxRetries` 2) and both throw paths (missing apiKey, missing fetch). No `close()`.
- Every `Sandboxes` method with exact TS signatures and `scope?`/params interfaces; `create` requires only `name`; `listSnapshots`/`snapshots` are paginated (`SnapshotPage`); `rollback` = in-place to chosen snapshot; `fork` = new sandbox from current live state (not a stored snapshot); included `connect`.
- `Sandbox` handle getters (`connectUrl` is `string | null`, plus `region`/`templateId`/`resources`), `waitUntilReady` (`Paused` fail-fast, timeout), overloaded `exec` (buffered vs `{ stream: true }`), deprecated `execStream`, `toJSON`.
- Runtime `SandboxConnection`/`SandboxFiles` with camelCase results (`bytesWritten`, `modifiedTime`, `symlinkTarget`), `ExecOptions`/`ExecResult`/`ExecStreamEvent`/`FileEntry`.
- Full error hierarchy with status mapping (incl. reason-code → status table) and `APIError` properties (`status`, `code`, `details`, `requestId`).
- `RawClient.request<T>` returns `undefined` on 204; no-retry runtime vs retrying lifecycle transport.

For type field tables sourced from the generated OpenAPI schema (e.g. `SandboxResources`, `MetricSeries`, exact `CreateSandboxRequest`/`Snapshot` field optionality), I noted they follow `src/generated/aiagent.ts` since `types.ts` only aliases them — that generated file was not in the read set, so those specific field lists are best-effort and flagged as such in the doc.
