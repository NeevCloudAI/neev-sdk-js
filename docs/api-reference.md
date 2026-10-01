# @neevcloud/sdk — API Reference

Task-oriented API lists and copy-paste snippets for the public `@neevcloud/sdk` package. Every lifecycle method is async — `await` it. For install, env vars, and first scripts, see [`getting-started.md`](./getting-started.md). For the exhaustive symbol inventory (every exported type, field tables, and the error hierarchy), see [`api-inventory.md`](./api-inventory.md).

## Table of contents

**Getting started**

- [Client](#client)

**Sandboxes** — client-level API

- [Lifecycle](#lifecycle)
- [Snapshots](#snapshots)

**Agents** — client-level API

- [Agents](#agents) — `neev.agents`, `neev.agentTemplates`, and the `Agent` handle

**Working with a sandbox**

- [Sandbox handle](#sandbox-handle)
- [Runtime](#runtime) — exec, files (write, read, list, stat, exists, mkdir, move, remove, watch), processes, pty, ssh

**Reference**

- [Errors](#errors)
- [Inline example snippets](#inline-example-snippets)
- [Maintaining this reference](#maintaining-this-reference)

---

## Client

Construct one `Neev` instance and reuse it; the resource namespaces (`sandboxes`, `templates`, `agents`, `agentTemplates`, `raw`) hang off the instance. Every config field is optional and falls back to a `NEEV_*` environment variable.

```ts
import { Neev } from "@neevcloud/sdk";

const neev = new Neev({
  apiKey: process.env.NEEV_API_KEY,     // or NEEV_API_KEY (required)
  orgId: process.env.NEEV_ORG_ID,       // or NEEV_ORG_ID
  projectId: process.env.NEEV_PROJECT_ID, // or NEEV_PROJECT_ID
});
```

```ts
new Neev(options?: NeevOptions)
```

Creates the platform client. Auth is a Bearer API key; the same API key authorizes runtime calls to a sandbox.

| Option | Env var | Default | Notes |
| ------ | ------- | ------- | ----- |
| `apiKey` | `NEEV_API_KEY` | — | Required. Throws if unset. |
| `orgId` | `NEEV_ORG_ID` | — | Required at call time; overridable per call via `Scope`. |
| `projectId` | `NEEV_PROJECT_ID` | — | Required at call time; overridable per call via `Scope`. |
| `baseURL` | — | `https://api.ai.neevcloud.com/agent` | Set only to target another environment. |
| `timeoutMs` | — | `60000` | Per-request timeout. |
| `maxRetries` | — | `2` | Retries on network errors, `429`, and `5xx` (lifecycle only). |
| `fetch` | — | global `fetch` | Custom fetch implementation. |

There is no `close()` — the client holds no persistent connections. Most methods accept an optional trailing `Scope` (`{ orgId?, projectId? }`) to target a different org/project than the client default.

---

## Lifecycle

Lifecycle APIs manage sandboxes and templates. Agents have their own section: [Agents](#agents).

### `neev.sandboxes`

Every method returns a `Sandbox` handle (or a page of handles) so callers can chain lifecycle actions on the result.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `create(params, scope?)` | `Promise<Sandbox>` | Creates a sandbox in the resolved org/project. The handle may still be `Pending` — call `waitUntilReady`. |
| `list(params?)` | `Promise<SandboxPage>` | Lists sandboxes with pagination; items are wrapped handles. |
| `get(id, scope?)` | `Promise<Sandbox>` | Fetches the current record for a sandbox by id or by name. Every method that takes an `id` accepts a name too. |
| `update(id, params, scope?)` | `Promise<Sandbox>` | Updates a running sandbox **in place** — `resources` (cpu/memory), `egress`, or an in-place `egress_add` / `egress_remove` edit. At least one is required. |
| `pause(id, scope?)` | `Promise<Sandbox>` | Pauses a sandbox: it stops running and keeps its state. |
| `resume(id, scope?)` | `Promise<Sandbox>` | Resumes a paused sandbox from its kept state. |
| `keepalive(id, scope?)` | `Promise<Sandbox>` | Resets the idle timer, holding a busy sandbox alive without an open connection. |
| `updateTimeout(id, windows, scope?)` | `Promise<Sandbox>` | Changes the idle/lifetime windows (seconds); only the fields passed change. |
| `delete(id, scope?)` | `Promise<void>` | Permanently deletes a sandbox. |
| `metrics(id, params?)` | `Promise<SandboxMetricsResponse>` | Reads the live, tenant-scoped metric series over an optional time window. |
| `audit(id, params?)` | `Promise<AuditTrail>` | Reads one page of the audit trail, newest first; `params` is `{ from?, to?, cursor?, limit? }`. |
| `exposePort(id, port, params?)` | `Promise<SandboxPort>` | Exposes a port for preview URLs; `params.slug` chooses or rotates the URL's slug. |
| `listPorts(id, scope?)` | `Promise<SandboxPort[]>` | Lists the exposed preview ports. |
| `revokePort(id, port, scope?)` | `Promise<void>` | Stops serving a preview port. |
| `getPortUrl(id, port, options?, scope?)` | `Promise<string>` | Exposes a port and returns its preview URL once routable; `options` = `{ slug?, waitUntilReady?, timeoutMs?, pollIntervalMs? }`. |
| `createSnapshot(id, params?, scope?)` | `Promise<SnapshotData>` | Captures a filesystem snapshot; returns immediately with `status: "Pending"`. |
| `listSnapshots(id, params?)` | `Promise<SnapshotPage>` | Lists a sandbox's snapshots. **Paginated** — accepts `{ page, limit }`, returns `{ items, total, page, limit }`. |
| `getSnapshot(snapshotId, scope?)` | `Promise<SnapshotData>` | Fetches snapshot metadata by project-scoped id. |
| `waitForSnapshot(snapshotId, params?)` | `Promise<SnapshotData>` | Polls until the snapshot is `Ready`; throws on `Failed` (with its error message) or timeout. |
| `deleteSnapshot(snapshotId, scope?)` | `Promise<void>` | Deletes a snapshot and its stored blob. |
| `rollback(id, snapshotId, scope?)` | `Promise<Sandbox>` | Rolls a sandbox back **in place** to one of its snapshots. |
| `fork(id, name, scope?)` | `Promise<Sandbox>` | Forks a sandbox into a new named sandbox from its **current live state**. |

**`create(params, scope?)`** — every field is optional; the platform generates a name and defaults the template when omitted. Compute size is set with `resources` (`cpu` / `memory_gb` / `disk_gb`); omit it (or any field) to take the platform default — see [`SandboxResources`](./api-inventory.md#sandboxresources) for defaults and ranges. Egress is deny-all by default; open it with the `allowInternet` / `allowEgress` convenience fields (same on `agents.create`), or a full `egress` object for finer control (which takes precedence). Set at most one of `sandbox_template_id` (catalogue) or `image` (BYOI — a public OCI image with a tag/digest, plus an optional `command`); omit both to use the platform default template. Pass `lifecycle` to set idle/lifetime windows at create time; omit it and account defaults apply (no `lifecycle` key is sent), and an out-of-enum `on_idle` throws before the request.

```ts
const sandbox = await neev.sandboxes.create({});
await sandbox.waitUntilReady();

// open all egress (0.0.0.0/0 + ::/0)
await neev.sandboxes.create({ name: "web", allowInternet: true });
// allow specific hosts (FQDN or CIDR, wildcards supported)
await neev.sandboxes.create({ name: "ci", allowEgress: ["github.com", "*.npmjs.org"] });

// BYOI: create from a public image with an explicit start command
await neev.sandboxes.create({ image: "docker.io/library/python:3.12-slim", command: ["sleep", "infinity"] });
// lifecycle windows (seconds): pause after 10 min idle, hard-stop after 2 h
await neev.sandboxes.create({ lifecycle: { idle_timeout_seconds: 600, max_lifetime_seconds: 7200, on_idle: "pause" } });
```

**`update(id, params, scope?)`** — updates a **running** sandbox in place and returns the updated handle; the id, name, and preview URLs are unchanged. `params` is `UpdateSandboxParams`: `resources` (cpu/memory, resized in place) and/or `egress` (replaces the policy in full; takes effect for new connections with **no restart**). It also accepts the same `allowInternet` / `allowEgress` convenience as `create` (byte-identical `egress` JSON). `egress_add` / `egress_remove` (each `{ allow: SandboxEgressRule[] }`) edit the existing allow-list in place instead — removals apply first, so one call can swap a host; they can't be combined with `egress` (or the convenience fields) and `egress_add` needs the sandbox to already be in `allow_list` mode. **At least one of `resources`, `egress`, `egress_add` or `egress_remove` is required** — an empty or conflicting patch throws `NeevError` before any request is sent. `disk_gb` is **not** resizable in place; if you change it the server rejects the patch (surfaced as a typed error, not silently dropped). Passing `resources` and `egress` together sends a single `PATCH` and both take effect.

```ts
// Resize cpu/memory in place.
await neev.sandboxes.update(id, { resources: { cpu: 2, memory_gb: 4 } });
// Re-scope egress (replaces the policy in full).
await neev.sandboxes.update(id, { allowEgress: ["api.github.com"] });
// Both in one PATCH.
await neev.sandboxes.update(id, { resources: { cpu: 4 }, allowInternet: true });
// Edit the allow-list in place, leaving every other rule alone.
await neev.sandboxes.update(id, { egress_add: { allow: [{ host: "pypi.org", ports: [443] }] } });
```

**`list(params?)`** — `params` is `{ page?, limit?, orgId?, projectId? }`; returns `SandboxPage` = `{ items: Sandbox[]; total; page; limit }`.

```ts
const { items, total } = await neev.sandboxes.list({ limit: 50 });
```

**`get` / `pause` / `resume` / `delete`**

```ts
const sandbox = await neev.sandboxes.get(id);
await neev.sandboxes.pause(id);
await neev.sandboxes.resume(id);
await neev.sandboxes.delete(id);
```

**`keepalive(id, scope?)` / `updateTimeout(id, windows, scope?)`** — lifecycle windows are in **seconds**. `keepalive` resets the idle timer (no body). `updateTimeout` changes only the windows passed: send `0` to turn a window off (no limit), an omitted field is left unchanged. `on_idle` is `"pause" | "delete"`; any other value throws before the request is sent. Windows: `idle_timeout_seconds`, `max_lifetime_seconds`, `paused_retention_seconds`, `on_idle`.

```ts
// Reset the idle timer (e.g. once per agent turn while work is in progress).
await neev.sandboxes.keepalive(id);

// Change only what you pass; send 0 to turn a window off, omit to leave unchanged.
await neev.sandboxes.updateTimeout(id, { idle_timeout_seconds: 600, on_idle: "pause" });
await neev.sandboxes.updateTimeout(id, { max_lifetime_seconds: 0 });
```

**`metrics(id, params?)`** — `params` is `{ from?, to?, step?, orgId?, projectId? }`; `from`/`to` are RFC3339, `step` is a Go duration (e.g. `"60s"`). The platform defaults to the last hour.

```ts
const metrics = await neev.sandboxes.metrics(id, { step: "60s" });
```

**`audit(id, params?)`** — `params` is `{ from?, to?, cursor?, limit?, orgId?, projectId? }`; `from` defaults to 24 hours before `to` (now), `limit` is 1–200 (default 50). Returns one page: `{ sandbox_id, from, to, retention_days, window_truncated, next_cursor?, records }`. Pass `next_cursor` back as `cursor` for the next page. Only program names are recorded, never arguments.

```ts
let page = await neev.sandboxes.audit(id, { limit: 50 });
while (page.next_cursor) page = await neev.sandboxes.audit(id, { cursor: page.next_cursor });
```

### `neev.templates`

Read-only catalogue. A template id (e.g. `"sb-ubuntu-26-04-minimal"`) is optional at create time; use this resource to discover valid ids.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `list(params?)` | `Promise<SandboxTemplatePage>` | Lists available templates with pagination (active and deprecated only). |
| `get(id)` | `Promise<SandboxTemplate>` | Fetches a single template by id. |

```ts
const { items } = await neev.templates.list({ limit: 10 });
const template = await neev.templates.get("sb-ubuntu-26-04-minimal");
```

### `neev.raw`

Untyped escape hatch for endpoints without a published OpenAPI spec yet. Shares the lifecycle transport (auth, retries, timeout, typed errors).

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `request<T>(req)` | `Promise<T>` | Issues an untyped HTTP call; `req` is `{ method, path, query?, body?, ... }`. |

```ts
const widget = await neev.raw.request<{ id: string }>({
  method: "GET",
  path: "/api/v1beta1/orgs/acme/projects/web/widgets/123",
});
```

---

## Snapshots

Snapshots capture a sandbox's filesystem state. They are **asynchronous**: `createSnapshot` / `sandbox.snapshot` return `status: "Pending"` and the snapshot must reach `"Ready"` before it can be restored or forked from. Status values are `"Pending" | "Running" | "Ready" | "Failed"`. To wait for `Ready`, either pass `{ waitUntilReady: true }` to `sandbox.snapshot` or call `waitForSnapshot(snapshotId)`; both resolve with the `Ready` snapshot and throw if the capture fails or the timeout elapses.

Two distinct paths:

- **`rollback(id, snapshotId)`** — rolls the **same** sandbox in place back to a **chosen** snapshot.
- **`fork(id, name)`** — atomically snapshots the source's **current live state** into a **brand-new** sandbox; it does **not** reuse an existing snapshot, and the source keeps running.

```ts
const sandbox = await neev.sandboxes.get(id);

// Capture filesystem state and block until it is Ready.
const snap = await sandbox.snapshot({ name: "checkpoint", waitUntilReady: true });

await sandbox.rollback(snap.id);            // roll this sandbox back in place
const fork = await sandbox.fork("my-fork"); // branch current live state into a new sandbox

const { items } = await neev.sandboxes.listSnapshots(id); // paginated: { page, limit }
await neev.sandboxes.deleteSnapshot(snap.id);
```

To create the snapshot without blocking and wait later, use `waitForSnapshot`:

```ts
const pending = await sandbox.snapshot({ name: "checkpoint" }); // status: "Pending"
const snap = await neev.sandboxes.waitForSnapshot(pending.id);  // resolves once Ready
```

`waitForSnapshot(snapshotId, params?)` accepts `WaitForSnapshotParams` = `Scope & { timeoutMs?: number (default 300000); pollIntervalMs?: number (default 2000) }`. `sandbox.snapshot(options?)` takes the snapshot-create field (`name`) plus `SnapshotWaitOptions` (`{ waitUntilReady?: boolean; timeoutMs?; pollIntervalMs? }`).

`listSnapshots` / `sandbox.snapshots()` return a `SnapshotPage` (`{ items: SnapshotData[]; total; page; limit }`) and accept `{ page, limit }`.

---

## Agents

An agent is a catalogue template (e.g. `"claude-code"`) running on a backing sandbox that the platform provisions for it, one to one. Manage it through `neev.agents`; reach its files, `exec`, and processes through `agent.sandbox()`. Every method that takes an `id` accepts the agent's name too.

### `neev.agents`

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `create(params, scope?)` | `Promise<Agent>` | Creates an agent from a catalogue template (`name` + `agent_template` required). The handle may still be `Provisioning` — call `waitUntilReady`. |
| `list(params?)` | `Promise<AgentPage>` | Lists agents; `params` = `{ page?, limit?, orgId?, projectId? }`. |
| `get(id, scope?)` | `Promise<Agent>` | Fetches an agent by id or by name. |
| `update(id, params, scope?)` | `Promise<Agent>` | Updates in place — `resources`, `egress`, `egress_add` / `egress_remove`, or `idle_timeout_seconds`. At least one is required. |
| `pause(id, scope?)` | `Promise<Agent>` | Pauses the agent's backing sandbox. |
| `resume(id, scope?)` | `Promise<Agent>` | Resumes a paused agent. |
| `keepalive(id, scope?)` | `Promise<Agent>` | Resets the idle timer so a busy agent stays running without an open connection. |
| `rollback(id, snapshotId, scope?)` | `Promise<Agent>` | Restores the agent's backing sandbox in place from a snapshot. |
| `exposePort(id, port, params?)` | `Promise<SandboxPort>` | Exposes an agent port for preview URLs; `params` = `{ slug?, orgId?, projectId? }`. |
| `listPorts(id, scope?)` | `Promise<SandboxPort[]>` | Lists the agent's exposed preview ports. |
| `revokePort(id, port, scope?)` | `Promise<void>` | Stops serving an agent preview port. |
| `getPortUrl(id, port, options?, scope?)` | `Promise<string>` | Exposes a port and returns its preview URL once routable; same options as `neev.sandboxes.getPortUrl`. |
| `audit(id, params?)` | `Promise<AuditTrail>` | Reads one page of what the agent ran in its sandbox; `params` = `{ from?, to?, cursor?, limit?, orgId?, projectId? }`. |
| `delete(id, scope?)` | `Promise<void>` | Permanently deletes the agent and its backing sandbox. |

**`create(params, scope?)`** — `params` is `CreateAgentParams`: `name` and `agent_template` are required; `config` overrides the template's `default_config`; `resources` and `egress` (or the `allowInternet` / `allowEgress` convenience) work as on `neev.sandboxes.create`. `idle_timeout_seconds` sets the idle window: omit it for the account default, or send `0` for no idle limit (the agent then holds quota until it is deleted).

**`update(id, params, scope?)`** — `params` is `UpdateAgentParams`, with the same `resources` / `egress` / `egress_add` / `egress_remove` rules as `neev.sandboxes.update`, plus `idle_timeout_seconds` (`0` removes the idle limit). **At least one of `resources`, `egress`, `egress_add`, `egress_remove` or `idle_timeout_seconds` is required**, and `egress_add` / `egress_remove` can't be combined with `egress` — either mistake throws `NeevError` before any request is sent.

```ts
const agent = await neev.agents.create({ name: "reviewer", agent_template: "claude-code", idle_timeout_seconds: 900 });
await agent.waitUntilReady();

await neev.agents.update(agent.id, { egress_add: { allow: [{ host: "api.github.com", ports: [443] }] } });
await neev.agents.keepalive(agent.id);              // e.g. once per agent turn
const port = await neev.agents.exposePort(agent.id, 3000);
const trail = await neev.agents.audit(agent.id, { limit: 50 });
```

The agent audit trail has the same shape and recording rules as the sandbox one. Its `sandbox_id` is the agent's backing sandbox, not the agent id.

### `neev.agentTemplates`

Read-only catalogue of agent templates. A template's `name` is what you pass as `agent_template` at create time.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `list(params?)` | `Promise<AgentTemplatePage>` | Lists active agent templates; `params` = `{ page?, limit? }`. |
| `get(id)` | `Promise<AgentTemplate>` | Fetches a single agent template by id. |

### `Agent` handle

Returned by `neev.agents.create`, `get`, and `list().items`.

| Member | Returns | Summary |
| ------ | ------- | ------- |
| `id` / `name` | `string` | Agent UUID and name. |
| `status` | `AgentStatus` | `"Provisioning" \| "Ready" \| "Paused" \| "Failed" \| "Deleting"`, as last seen. |
| `templateId` / `sandboxId` | `string` | Template it was created from; id of its backing sandbox. |
| `config` | `Record<string, unknown> \| undefined` | Effective template config. |
| `idleTimeoutSeconds` | `number \| null` | Idle window in seconds; `0` = no idle limit, `null` = account default. |
| `lastCrash` | `AgentLastCrash \| null` | Most recent unexpected stop; same semantics as `sandbox.lastCrash`. |
| `data` / `toJSON()` | `AgentData` | Raw API record. |
| `waitUntilReady(options?)` | `Promise<this>` | Polls until `"Ready"`; throws fast on `"Failed"` or `"Paused"`, or on timeout. `options` = `{ timeoutMs?, pollIntervalMs? }`. |
| `refresh()` | `Promise<this>` | Re-fetches and updates the handle. |
| `update(params)` / `pause()` / `resume()` / `keepalive()` | `Promise<this>` | Lifecycle actions; each updates the handle. |
| `rollback(snapshotId)` | `Promise<this>` | Restores the backing sandbox from a snapshot and updates the handle. |
| `exposePort(port, options?)` / `listPorts()` / `revokePort(port)` | — | Preview ports, as on the sandbox handle. |
| `getUrl(options)` | `Promise<string>` | Exposes `options.port` and returns its preview URL once routable; `options` = `{ port, slug?, waitUntilReady?, timeoutMs?, pollIntervalMs? }`. |
| `audit(params?)` | `Promise<AuditTrail>` | One page of the audit trail; `params` = `{ from?, to?, cursor?, limit? }`. |
| `sandbox()` | `Promise<Sandbox>` | The backing sandbox as a `Sandbox` handle, for `files` / `exec` / `processes`. |
| `delete()` | `Promise<void>` | Permanently deletes the agent. |

```ts
const agent = await neev.agents.get("reviewer");
const url = await agent.getUrl({ port: 3000 });
await agent.keepalive();
const sandbox = await agent.sandbox();
await sandbox.files.write("notes.md", "# hello\n");
```

---

## Sandbox handle

`Sandbox` instances are returned by `create()`, `get()`, and `list().items`. They carry the last-known server state and expose lifecycle and runtime actions that operate on this sandbox in place. Construct via the `sandboxes` resource, never directly.

### Getters

| Getter | Type | Summary |
| ------ | ---- | ------- |
| `id` | `string` | Sandbox UUID. |
| `name` | `string` | Human-readable name. |
| `phase` | `SandboxPhase` | Lifecycle phase as last seen (e.g. `"Pending"`, `"Ready"`, `"Paused"`). |
| `replicas` | `number` | `1` while running, `0` while paused. |
| `region` | `string` | Region slug the sandbox runs in. |
| `templateId` | `string \| null` | Template id it was created from, or `null`. |
| `resources` | `SandboxResources \| undefined` | Provisioned compute size, or `undefined` when defaulted. |
| `connectUrl` | `string \| null` | Runtime address, or `null` when not yet configured. |
| `addressable` | `boolean` | Whether the sandbox can be reached yet; briefly `false` after create. `waitUntilReady` and runtime calls wait for it. |
| `lastCrash` | `SandboxLastCrash \| null` | Most recent unexpected stop, or `null` if the sandbox has never had one. `storage_reset: true` means it restarted with an empty filesystem — files under `/workspace`, and anything installed since create, are gone. Historical: not cleared when the sandbox recovers; restoring from a snapshot taken before that stop brings the files back and clears it. |
| `data` | `SandboxData` | Full raw API record. |

### Methods

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `waitUntilReady(options?)` | `Promise<this>` | Polls until phase is `"Ready"` and the sandbox is addressable. Throws fast if `"Paused"`, or on timeout. |
| `refresh()` | `Promise<this>` | Re-fetches the record and updates the handle in place. |
| `update(params)` | `Promise<this>` | Updates in place (`resources`, `egress`, or `egress_add` / `egress_remove`) and updates the handle. |
| `pause()` | `Promise<this>` | Pauses (stops running, keeps state) and updates the handle. |
| `resume()` | `Promise<this>` | Resumes from the kept state and updates the handle. |
| `keepalive()` | `Promise<this>` | Resets the idle timer and updates the handle. |
| `updateTimeout(windows)` | `Promise<this>` | Changes the idle/lifetime windows (seconds) and updates the handle. |
| `delete()` | `Promise<void>` | Permanently deletes the sandbox. |
| `metrics(params?)` | `Promise<SandboxMetricsResponse>` | Reads the live metric series; `params` is `{ from?, to?, step? }`. |
| `audit(params?)` | `Promise<AuditTrail>` | Reads one page of the audit trail; `params` is `{ from?, to?, cursor?, limit? }`. |
| `snapshot(options?)` | `Promise<SnapshotData>` | Captures this sandbox's state (starts `Pending`). Pass `{ waitUntilReady: true }` to resolve only once the snapshot is `Ready`. |
| `snapshots(params?)` | `Promise<SnapshotPage>` | Lists this sandbox's snapshots (paginated: `{ page, limit }`). |
| `rollback(snapshotId)` | `Promise<this>` | Rolls this sandbox back in place to a chosen snapshot. |
| `fork(name)` | `Promise<Sandbox>` | Forks the current live state into a new sandbox handle. |
| `getUrl(options)` | `Promise<string>` | Exposes `options.port` and returns its public preview URL, waiting until the URL is routable. `options` = `{ port, slug?, waitUntilReady?, timeoutMs?, pollIntervalMs? }`. |
| `exposePort(port, options?)` | `Promise<SandboxPort>` | Exposes a port for preview URLs (no readiness wait). `options.slug` chooses the URL's slug; a different slug on an exposed port rotates it and breaks the old URL. |
| `listPorts()` | `Promise<SandboxPort[]>` | Lists the ports currently exposed for preview URLs. |
| `revokePort(port)` | `Promise<void>` | Stops serving a previously exposed port. |
| `ssh(options?)` | `Promise<SshTunnel>` | Opens a local SSH tunnel (loopback listener) to the sandbox; `options` = `{ port?, host? }`. Node only (see runtime). |
| `files` | `SandboxFiles` (getter) | Filesystem operations on this sandbox (see runtime). |
| `processes` | `SandboxProcesses` (getter) | Detached-process supervisor on this sandbox (see runtime). |
| `exec(command, options?)` | `Promise<ExecResult>` \| `AsyncGenerator<ExecStreamEvent>` | Runs a command (see runtime). |
| `toJSON()` | `SandboxData` | Raw record, so `JSON.stringify(sandbox)` emits the API shape. |

`waitUntilReady(options?)` accepts `WaitOptions` = `{ timeoutMs?: number (default 120000); pollIntervalMs?: number (default 2000) }`.

```ts
const sandbox = await neev.sandboxes.get(id);
await sandbox.waitUntilReady({ timeoutMs: 120_000 });
await sandbox.pause();
await sandbox.resume();
const fork = await sandbox.fork("my-fork");
console.log(sandbox.id, sandbox.phase, sandbox.connectUrl);
```

---

## Runtime

Runtime APIs run commands and access files **inside** a sandbox, reached directly at the sandbox's `connect_url`. Use `sandbox.exec` / `sandbox.files` on the handle — it resolves and caches the connection automatically, waiting until the sandbox is `Ready` on first use. These calls are **never retried** (a retried `write`/`exec` could run twice). File paths are relative to the workspace, or absolute inside it (a path outside the workspace is refused). Chunked uploads are the one exception to "never retried": a failed chunk resumes from the last byte the sandbox received.

### Exec

`sandbox.exec` is **buffered by default** and resolves to a full `ExecResult`. Pass `{ stream: true }` to instead get a live `AsyncGenerator<ExecStreamEvent>`. A non-zero exit code is **reported, never thrown**. `sandbox.execStream(command, options?)` is a **deprecated** alias for `exec(command, { stream: true })`.

```ts
exec(command: string | string[], options?: ExecOptions): Promise<ExecResult>
exec(command: string | string[], options: ExecOptions & { stream: true }): AsyncGenerator<ExecStreamEvent>
```

`ExecOptions`: `{ args?, cwd?, env?, timeoutMs?, stdin?, signal?, stream? }`. Pass arguments either in the command array or via `options.args`, not both.

Buffered — `ExecResult` = `{ stdout: string; stderr: string; exitCode: number }`:

```ts
const result = await sandbox.exec(["sh", "-c", "python3 main.py"]);
console.log(result.exitCode, result.stdout);
```

Streaming — yields `ExecStreamEvent` (`{ type: "stdout"; data } | { type: "stderr"; data } | { type: "exit"; exitCode }`):

```ts
for await (const event of sandbox.exec(["sh", "-c", "for i in 1 2 3; do echo $i; sleep 1; done"], {
  stream: true,
})) {
  if (event.type === "stdout") process.stdout.write(event.data);
  else if (event.type === "stderr") process.stderr.write(event.data);
  else console.log("exit", event.exitCode); // non-zero reported here, not thrown
}
```

### `sandbox.files`

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `write(path, content, options?)` | `Promise<WriteFileResult>` | Writes string or `Uint8Array`; returns `{ bytesWritten }`. Content over 1 MiB is sent with `upload` automatically. |
| `upload(path, data, options?)` | `Promise<WriteFileResult>` | Uploads a string, `Uint8Array`, `ArrayBuffer` or `Blob` in resumable chunks; `options` = `{ chunkSize?, cwd?, onProgress?, signal? }` (`chunkSize` 64 KiB–1 MiB, default 1 MiB). |
| `uploadFile(localPath, remotePath, options?)` | `Promise<WriteFileResult>` | Node only. Uploads a local file chunk by chunk, never holding it in memory whole. Same options as `upload`. |
| `downloadFile(remotePath, localPath, options?)` | `Promise<DownloadFileResult>` | Node only. Streams a sandbox file to disk; returns `{ bytesWritten }`. Nothing is left at `localPath` if it fails. `options` = `{ cwd?, signal? }`. |
| `read(path, options?)` | `Promise<Uint8Array>` | Reads a file as raw bytes (binary-safe). |
| `readText(path, options?)` | `Promise<string>` | Reads a file and decodes it as UTF-8. |
| `list(path, options?)` | `Promise<FileEntry[]>` | Lists directory entries; `options` = `{ cwd?, recursive?, maxCount?, signal? }`. |
| `stat(path, options?)` | `Promise<FileEntry>` | Returns metadata for one entry; `options` = `{ cwd?, signal? }`. |
| `exists(path, options?)` | `Promise<boolean>` | Reports whether a path exists. |
| `mkdir(path, options?)` | `Promise<FileEntry>` | Creates a directory and any missing parents. |
| `move(source, destination, options?)` | `Promise<FileEntry>` | Moves or renames an entry. |
| `remove(path, options?)` | `Promise<void>` | Deletes a file or directory; `options` = `{ cwd?, recursive?, signal? }`. |
| `watch(path, options?)` | `AsyncGenerator<WatchEvent>` | Streams filesystem changes live; `options` = `{ cwd?, recursive?, timeoutMs?, signal? }`. |

```ts
await sandbox.files.write("main.py", "print('hi')"); // → { bytesWritten }
const bytes = await sandbox.files.read("main.py");    // → Uint8Array
const text = await sandbox.files.readText("main.py"); // → string
const entries = await sandbox.files.list(".", { recursive: true }); // → FileEntry[]

const info = await sandbox.files.stat("main.py");        // → FileEntry
const there = await sandbox.files.exists("main.py");     // → boolean
await sandbox.files.mkdir("out/logs");                   // → FileEntry
await sandbox.files.move("main.py", "app.py");           // → FileEntry
await sandbox.files.remove("out", { recursive: true });  // → void

for await (const ev of sandbox.files.watch(".", { recursive: true })) {
  console.log(ev.type, ev.path); // WatchEvent: { type, path, entry? }
}
```

`FileEntry`: `{ name; type: "file" | "directory" | "symlink"; path; size; mode; permissions; modifiedTime; symlinkTarget? }`.

`WatchEvent`: `{ type: "create" | "write" | "remove" | "rename" | "chmod"; path; entry? }`.

### `sandbox.processes`

Runs **detached** processes whose lifetime outlives the request that started them, each addressed by a stable `process_id`. `start` returns a `Process` handle; collection-level operations live on `sandbox.processes`.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `start(command, options?)` | `Promise<Process>` | Starts a detached process; `options` = `{ args?, cwd?, env?, stdin?, signal? }`. |
| `get(id, options?)` | `Promise<ProcessStatus>` | Status snapshot; `{ wait: true }` blocks until the process exits. |
| `list(options?)` | `Promise<ProcessInfo[]>` | All tracked processes (running + recently-exited). |
| `kill(id, signal?)` | `Promise<boolean>` | Signals one process (default SIGTERM); returns whether a signal was delivered. |
| `killAll(signal?)` | `Promise<number>` | Signals every running process; returns the count signalled. |
| `logs(id, options?)` | `Promise<ProcessLogsPage>` | Polls captured output from `{ cursor? }`; returns `{ entries, cursor, dropped, state }`. |
| `follow(id, options?)` | `AsyncGenerator<ProcessLogEvent>` | Streams output until exit; a caller abort ends it without an `exit` event. |

The `Process` handle exposes `id`, `state`, `exitCode`, `startedAt`, and `status()`, `wait()`, `kill(signal?)`, `logs(options?)`, `follow(options?)`.

```ts
const proc = await sandbox.processes.start("npm", { args: ["run", "dev"], cwd: "app" });
for await (const event of proc.follow()) {
  if (event.type === "stdout") process.stdout.write(event.data);
}
const final = await proc.wait();   // → { state: "exited", exitCode, … }
await sandbox.processes.killAll(Signal.TERM);
```

`ProcessState` is `"running" | "exited"`. `Signal` is a const of the accepted signal numbers: `{ HUP, INT, QUIT, KILL, TERM }`. Poll `entries[].data` is plain UTF-8; follow `stdout`/`stderr` chunks are decoded for you.

### `sandbox.pty`

Opens an interactive pseudo-terminal over a WebSocket. `create` returns a `PtyHandle`; output streams to the `onData` callback.

| Member | Returns | Summary |
| ------ | ------- | ------- |
| `create(options?)` | `Promise<PtyHandle>` | Opens a PTY (or reattaches with `{ id }`); `options` = `{ id?, program?, args?, cols?, rows?, onData? }`. Resolves once connected. |
| `handle.id` | `string \| undefined` | The terminal id, for reattaching later with `create({ id })`. |
| `handle.sendInput(data)` | `void` | Sends keystrokes/bytes (`string \| Uint8Array`) to the terminal. |
| `handle.resize(cols, rows)` | `void` | Forwards a window-size change. |
| `handle.kill(signal?)` | `void` | Signals the process group by name (default `"SIGTERM"`). |
| `handle.wait()` | `Promise<PtyResult>` | Resolves with `{ exitCode }` when the session ends. |
| `handle.disconnect()` | `void` | Closes the socket; the terminal keeps running. `wait` then resolves. |

```ts
const pty = await sandbox.pty.create({ cols: 80, rows: 24, onData: (b) => process.stdout.write(b) });
pty.sendInput("ls -la\n");
pty.resize(120, 40);
const { exitCode } = await pty.wait();

// Reattach after a dropped connection — the sandbox replays recent scrollback:
const again = await sandbox.pty.create({ id: pty.id, onData: (b) => process.stdout.write(b) });
```

The PTY needs a `WebSocket`. It uses the runtime's global one if present; in Node, pass a header-capable WebSocket (the global cannot send auth headers): `new Neev({ webSocket: (url, opts) => new WebSocket(url, opts) })` with the [`ws`](https://www.npmjs.com/package/ws) package.

### `sandbox.ssh`

Opens an SSH tunnel: a loopback TCP listener that forwards each connection to the sandbox over an authenticated WebSocket, so any ssh client, `scp`/`rsync`, or IDE remote-dev points at the returned `{ host, port }` with no keys to manage and no public port.

| Member | Returns | Summary |
| ------ | ------- | ------- |
| `sandbox.ssh(options?)` | `Promise<SshTunnel>` | Binds the listener (`options` = `{ port?, host? }`; defaults to a free ephemeral port on `127.0.0.1`) and resolves once it is listening. |
| `tunnel.host` / `tunnel.port` | `string` / `number` | Address the listener is bound to. |
| `tunnel.close()` | `Promise<void>` | Stops the listener and drops in-flight connections. Idempotent. |

```ts
const tunnel = await sandbox.ssh(); // binds 127.0.0.1 on a free port
console.log(`ssh -p ${tunnel.port} neev@localhost`);
await tunnel.close();
```

Node only — it opens a local TCP listener. It uses the client's `webSocket` factory when set, else loads the [`ws`](https://www.npmjs.com/package/ws) package automatically (no factory required, unlike the PTY); resolved once up front, so a missing `ws` throws immediately.

### Low-level connection types

Listed for completeness; prefer the handle methods above.

| Type | Summary |
| ---- | ------- |
| `SandboxConnection` | A live connection to one sandbox's runtime. Construct via `neev.createSandboxConnection(connectUrl)`, or reach it through `sandbox.exec` / `sandbox.files` / `sandbox.processes` / `sandbox.pty`. Exposes `exec`, `execStream`, and `files` / `processes` / `pty` facades. |
| `SandboxFiles` | The filesystem facade (`write`/`upload`/`read`/`readText`/`list`/…). Accessed via `sandbox.files` or `connection.files`. |
| `SandboxProcesses` | The process-supervisor facade (`start`/`get`/`list`/`kill`/`killAll`/`logs`/`follow`). Accessed via `sandbox.processes` or `connection.processes`. |
| `SandboxPty` | The interactive-terminal facade (`create` → `PtyHandle`). Accessed via `sandbox.pty` or `connection.pty`. |

---

## Errors

Every failure is a `NeevError` subclass — branch on `instanceof` rather than parsing strings. `APIError` carries `status`, `code`, `scope`, `details`, and `requestId`. `code` is a machine-readable `ErrorCode` (`not_found`, `validation_error`, `sandbox_quota_exceeded`, …) — branch on it rather than on the message text; `scope` says which limit a quota refusal hit (`organization` or `project`). Errors from a sandbox's runtime (files, exec, processes) carry the runtime's reason code in `code` (e.g. `not_found`, `invalid_argument`, `permission_denied`) and its explanation in the error message.

```ts
import { NotFoundError, RateLimitError, APIError } from "@neevcloud/sdk";

try {
  await neev.sandboxes.get("missing");
} catch (err) {
  if (err instanceof NotFoundError) {
    // 404 — handle missing sandbox
  } else if (err instanceof APIError) {
    console.error(err.status, err.code, err.requestId);
  }
}
```

| Class | Status | Meaning |
| ----- | ------ | ------- |
| `NeevError` | — | Base class for every SDK error. |
| `APIConnectionError` | — | No HTTP response (DNS, reset, abort). |
| `APITimeoutError` | — | Request exceeded the configured timeout. |
| `APIError` | non-2xx | Base for HTTP responses; carries `status`/`code`/`scope`/`details`/`requestId`. |
| `BadRequestError` | 400 | Malformed or invalid request. |
| `AuthenticationError` | 401 | Missing, invalid, or expired API key. |
| `PermissionDeniedError` | 403 | Not allowed on this org/project/resource. |
| `NotFoundError` | 404 | Resource does not exist. |
| `ConflictError` | 409 | Conflicts with current state. |
| `PreconditionFailedError` | 412 | A precondition failed. |
| `RateLimitError` | 429 | Rate limit exceeded. |
| `DeadlineExceededError` | 504 | Operation exceeded the server deadline. |
| `InternalServerError` | 5xx | Server failed to handle a valid request. |
| `ServiceUnavailableError` | 503 | Temporarily unavailable; retry shortly. A subclass of `InternalServerError`. |

---

## Inline example snippets

Minimal one-liners for each public API.

### Lifecycle

| API | Snippet |
| --- | ------- |
| `new Neev(...)` | `const neev = new Neev({ apiKey, orgId, projectId });` |
| `neev.sandboxes.create(...)` | `const sandbox = await neev.sandboxes.create({});` |
| `neev.sandboxes.list(...)` | `const { items } = await neev.sandboxes.list({ name: "web", status: "Paused" });` |
| `neev.sandboxes.get(id)` | `const sandbox = await neev.sandboxes.get(id);` |
| `neev.sandboxes.pause(id)` | `await neev.sandboxes.pause(id);` |
| `neev.sandboxes.resume(id)` | `await neev.sandboxes.resume(id);` |
| `neev.sandboxes.delete(id)` | `await neev.sandboxes.delete(id);` |
| `neev.sandboxes.metrics(id, ...)` | `const m = await neev.sandboxes.metrics(id, { step: "60s" });` |
| `neev.sandboxes.audit(id, ...)` | `const trail = await neev.sandboxes.audit(id, { limit: 50 });` |
| `neev.sandboxes.update(id, ...)` | `await neev.sandboxes.update(id, { egress_remove: { allow: [{ host: "pypi.org" }] } });` |
| `neev.sandboxes.keepalive(id)` | `await neev.sandboxes.keepalive(id);` |
| `neev.sandboxes.exposePort(id, port, ...)` | `const p = await neev.sandboxes.exposePort(id, 3000, { slug: "k3x9q2ab" });` |
| `neev.sandboxes.createSnapshot(id, ...)` | `const snap = await neev.sandboxes.createSnapshot(id, { name: "checkpoint" });` |
| `neev.sandboxes.listSnapshots(id, ...)` | `const { items } = await neev.sandboxes.listSnapshots(id, { page: 1, limit: 20 });` |
| `neev.sandboxes.getSnapshot(snapshotId)` | `const snap = await neev.sandboxes.getSnapshot(snapshotId);` |
| `neev.sandboxes.waitForSnapshot(snapshotId)` | `const snap = await neev.sandboxes.waitForSnapshot(snapshotId);` |
| `neev.sandboxes.deleteSnapshot(snapshotId)` | `await neev.sandboxes.deleteSnapshot(snapshotId);` |
| `neev.sandboxes.rollback(id, snapshotId)` | `await neev.sandboxes.rollback(id, snapshotId);` |
| `neev.sandboxes.fork(id, name)` | `const fork = await neev.sandboxes.fork(id, "my-fork");` |
| `neev.templates.list(...)` | `const { items } = await neev.templates.list({ limit: 10 });` |
| `neev.templates.get(id)` | `const tpl = await neev.templates.get("sb-ubuntu-26-04-minimal");` |
| `neev.agents.create(...)` | `const agent = await neev.agents.create({ name: "reviewer", agent_template: "claude-code" });` |
| `neev.agents.keepalive(id)` | `await neev.agents.keepalive(id);` |
| `neev.agents.rollback(id, snapshotId)` | `await neev.agents.rollback(id, snapshotId);` |
| `neev.agents.audit(id, ...)` | `const trail = await neev.agents.audit(id, { limit: 50 });` |
| `neev.agentTemplates.list(...)` | `const { items } = await neev.agentTemplates.list();` |
| `agent.getUrl(...)` | `const url = await agent.getUrl({ port: 3000 });` |
| `agent.sandbox()` | `const sandbox = await agent.sandbox();` |
| `neev.raw.request(...)` | `const data = await neev.raw.request<T>({ method: "GET", path });` |
| `sandbox.id` / `.name` / `.phase` | `console.log(sandbox.phase, sandbox.replicas);` |
| `sandbox.connectUrl` | `console.log(sandbox.connectUrl);` |
| `sandbox.data` | `const record = sandbox.data;` |
| `sandbox.refresh()` | `await sandbox.refresh();` |
| `sandbox.waitUntilReady(...)` | `await sandbox.waitUntilReady({ timeoutMs: 120_000 });` |
| `sandbox.pause()` / `sandbox.resume()` | `await sandbox.pause();  await sandbox.resume();` |
| `sandbox.snapshot(...)` | `const pending = await sandbox.snapshot({ name: "demo-snap" });` |
| `sandbox.snapshots(...)` | `const { items } = await sandbox.snapshots({ page: 1, limit: 20 });` |
| `sandbox.rollback(snapshotId)` | `await sandbox.rollback(snapshotId);` |
| `sandbox.fork(name)` | `const fork = await sandbox.fork("my-fork");` |
| `sandbox.delete()` | `await sandbox.delete();` |
| `sandbox.metrics(...)` | `const m = await sandbox.metrics({ step: "60s" });` |
| `sandbox.audit(...)` | `const { records, next_cursor } = await sandbox.audit({ limit: 50 });` |
| `sandbox.addressable` | `console.log(sandbox.addressable);` |
| `sandbox.getUrl(...)` | `const url = await sandbox.getUrl({ port: 3000 });` |
| `sandbox.exposePort(...)` | `const p = await sandbox.exposePort(3000, { slug: "k3x9q2ab" });` |
| `sandbox.toJSON()` | `JSON.stringify(sandbox);` |

### Runtime

| API | Snippet |
| --- | ------- |
| `sandbox.exec(...)` (buffered) | `const r = await sandbox.exec(["echo", "hi"]);` |
| `sandbox.exec(..., { stream: true })` | `for await (const e of sandbox.exec(cmd, { stream: true })) { /* … */ }` |
| `sandbox.execStream(...)` (deprecated) | `for await (const e of sandbox.execStream(cmd)) { /* … */ }` |
| `sandbox.files.write(...)` | `await sandbox.files.write("main.py", "print('hi')");` |
| `sandbox.files.upload(...)` | `await sandbox.files.upload("data.bin", bytes, { onProgress: (sent, total) => {} });` |
| `sandbox.files.uploadFile(...)` | `await sandbox.files.uploadFile("./data.bin", "data.bin");` |
| `sandbox.files.downloadFile(...)` | `const { bytesWritten } = await sandbox.files.downloadFile("out.tar", "./out.tar");` |
| `sandbox.files.read(...)` | `const bytes = await sandbox.files.read("main.py");` |
| `sandbox.files.readText(...)` | `const text = await sandbox.files.readText("main.py");` |
| `sandbox.files.list(...)` | `const entries = await sandbox.files.list(".", { recursive: true });` |
| `sandbox.ssh()` | `const t = await sandbox.ssh(); // then: ssh -p ${t.port} neev@localhost` |
| `SandboxConnection` (low-level) | `const conn = neev.createSandboxConnection(sandbox.connectUrl!);` |
| `SandboxFiles` (low-level) | via `sandbox.files` or `conn.files` |

---

## Maintaining this reference

Any PR that modifies public SDK exports (`src/index.ts`) must update:

- [`docs/api-reference.md`](./api-reference.md) — grouped API lists and inline snippets (this file)
- [`docs/api-inventory.md`](./api-inventory.md) — exhaustive signatures, type field tables, symbol index
- [`docs/getting-started.md`](./getting-started.md) — if install, env vars, or quick-start flows change
- [`examples/`](../examples/) — if a new capability lacks a runnable example

Field-level type tables live in [`api-inventory.md`](./api-inventory.md) only — verify them against `src/generated/aiagent.ts` after the types are regenerated.
