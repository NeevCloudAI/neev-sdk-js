# API reference

Every product and method in `@neevcloud/sdk`, grouped by product, with copy-paste snippets. Every method is async: `await` it. For install, credentials and a first sandbox, see [Getting started](./getting-started.md). For every exported type and field, see the [API inventory](./api-inventory.md).

## Contents

- [Client and configuration](#client-and-configuration)
- [Sandboxes](#sandboxes): [`neev.sandboxes`](#neevsandboxes), [Audit trail](#audit-trail), [Templates](#templates), [Snapshots, fork and rollback](#snapshots-fork-and-rollback), [Sandbox handle](#sandbox-handle), [Commands and processes](#commands-and-processes), [Files](#files), [Terminals and SSH](#terminals-and-ssh), [Code interpreter](#code-interpreter)
- [Agents](#agents): [`neev.agents`](#neevagents), [Agent templates](#agent-templates), [`Agent` handle](#agent-handle)
- [Agent tools](#agent-tools): [The tool contract](#the-tool-contract), [Framework adapters](#framework-adapters)
- [Errors](#errors)
- [Inline example snippets](#inline-example-snippets)

---

## Client and configuration

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
| `timeoutMs` | — | `60000` | Per-request timeout. |
| `maxRetries` | — | `2` | Retries on network errors, `429`, and `5xx` (lifecycle only). |
| `fetch` | — | global `fetch` | Custom fetch implementation. |
| `webSocket` | — | global `WebSocket` | Factory for terminal sessions. In Node, pass one built on the `ws` package. |

There is no `close()` — the client holds no persistent connections. Most methods accept an optional trailing `Scope` (`{ orgId?, projectId? }`) to target a different org/project than the client default.

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

## Sandboxes

A sandbox is an isolated machine for your code. `neev.sandboxes` and `neev.templates` manage sandboxes; the `Sandbox` handle and its runtime properties work inside one.

### `neev.sandboxes`

Every method returns a `Sandbox` handle (or a page of handles) so callers can chain lifecycle actions on the result.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `create(params, scope?)` | `Promise<Sandbox>` | Creates a sandbox in the resolved org/project. The handle may still be `Pending` — call `waitUntilReady`. |
| `list(params?)` | `Promise<SandboxPage>` | Lists sandboxes with pagination; items are wrapped handles. |
| `get(id, scope?)` | `Promise<Sandbox>` | Fetches the current record for a sandbox by id or by name. Every method that takes an `id` accepts a name too. |
| `update(id, params, scope?)` | `Promise<Sandbox>` | Updates a running sandbox **in place** — `resources` (cpu/memory), `egress`, an in-place `egress_add` / `egress_remove` edit, or `execution_trace`. At least one is required. |
| `pause(id, scope?)` | `Promise<Sandbox>` | Pauses a sandbox: it stops running and keeps its state. |
| `resume(id, scope?)` | `Promise<Sandbox>` | Resumes a paused sandbox from its kept state. |
| `keepalive(id, scope?)` | `Promise<Sandbox>` | Resets the idle timer, holding a busy sandbox alive without an open connection. |
| `updateTimeout(id, windows, scope?)` | `Promise<Sandbox>` | Changes the idle/lifetime windows (seconds); only the fields passed change. |
| `delete(id, scope?)` | `Promise<void>` | Permanently deletes a sandbox. |
| `metrics(id, params?)` | `Promise<SandboxMetricsResponse>` | Reads the live, tenant-scoped metric series over an optional time window. |
| `audit(id, params?)` | `Promise<AuditTrail>` | Reads one page of the audit trail, newest first: calls, programs and connections. See [Audit trail](#audit-trail). |
| `exposePort(id, port, params?)` | `Promise<SandboxPort>` | Exposes a port for preview URLs; `params.slug` chooses or rotates the URL's slug. |
| `listPorts(id, scope?)` | `Promise<SandboxPort[]>` | Lists the exposed preview ports. |
| `revokePort(id, port, scope?)` | `Promise<void>` | Stops serving a preview port. |
| `getPortUrl(id, port, options?, scope?)` | `Promise<string>` | Exposes a port and returns its preview URL once routable; `options` = `{ slug?, waitUntilReady?, timeoutMs?, pollIntervalMs? }`. |
| `createSnapshot(id, params?, scope?)` | `Promise<SnapshotData>` | Captures the sandbox's full state (files and running processes' memory); returns immediately with `status: "Pending"`. |
| `listSnapshots(id, params?)` | `Promise<SnapshotPage>` | Lists a sandbox's snapshots. **Paginated** — accepts `{ page, limit }`, returns `{ items, total, page, limit }`. |
| `getSnapshot(snapshotId, scope?)` | `Promise<SnapshotData>` | Fetches snapshot metadata by project-scoped id. |
| `waitForSnapshot(snapshotId, params?)` | `Promise<SnapshotData>` | Polls until the snapshot is `Ready`; throws on `Failed` (with its error message) or timeout. |
| `deleteSnapshot(snapshotId, scope?)` | `Promise<void>` | Deletes a snapshot and its stored blob. |
| `rollback(id, snapshotId, scope?)` | `Promise<Sandbox>` | Rolls a sandbox back **in place** to one of its snapshots. |
| `fork(id, name, scope?)` | `Promise<Sandbox>` | Forks a sandbox into a new named sandbox from its **current live state**. |

**`create(params, scope?)`** — every field is optional.

| Field | Notes |
| --- | --- |
| `name` | Generated when omitted |
| `sandbox_template_id` | A catalogue template; omit for the default. Set at most one of this and `image` |
| `image`, `command` | Bring your own image: a public OCI image with a tag or digest, and an optional start command |
| `resources` | `cpu`, `memory_gb`, `disk_gb`; omitted fields take the default (see [`SandboxResources`](./api-inventory.md#sandboxresources)) |
| `allowInternet`, `allowEgress` | Open outbound network; egress is deny-all by default |
| `egress` | A full egress policy; takes precedence over the two fields above |
| `lifecycle` | Idle and lifetime windows; omit for account defaults. An invalid `on_idle` throws before the request |
| `labels` | Up to 16 key-value pairs that `list` can filter on; a malformed label is rejected with `BadRequestError` |

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
// labels for finding it later with list({ labels })
await neev.sandboxes.create({ labels: { team: "payments", "ci-run": "4821" } });
```

**`update(id, params, scope?)`** — changes a **running** sandbox in place and returns the updated handle. The id, name and preview URLs stay the same.

| Field | Effect |
| --- | --- |
| `resources` | Resize cpu and memory in place. `disk_gb` can't be resized; the server rejects it with a typed error |
| `egress` (or `allowInternet` / `allowEgress`) | Replace the egress policy in full. New connections use it at once, with no restart |
| `egress_add`, `egress_remove` | Edit the existing allow-list in place (`{ allow: SandboxEgressRule[] }`). Removals apply first, so one call can swap a host. `egress_add` needs the sandbox to already be in `allow_list` mode |
| `execution_trace` | `false` stops recording every program the sandbox runs; `true` turns it back on. On by default, no restart. The change is written to your organization's audit log |

- Pass at least one of `resources`, `egress`, `egress_add`, `egress_remove` or `execution_trace`.
- `egress_add` / `egress_remove` can't be combined with `egress` or the convenience fields.
- An empty or conflicting patch throws `NeevError` before any request is sent.
- `resources` and `egress` together are sent as one request, and both take effect.

```ts
// Resize cpu/memory in place.
await neev.sandboxes.update(id, { resources: { cpu: 2, memory_gb: 4 } });
// Re-scope egress (replaces the policy in full).
await neev.sandboxes.update(id, { allowEgress: ["api.github.com"] });
// Both in one PATCH.
await neev.sandboxes.update(id, { resources: { cpu: 4 }, allowInternet: true });
// Edit the allow-list in place, leaving every other rule alone.
await neev.sandboxes.update(id, { egress_add: { allow: [{ host: "pypi.org", ports: [443] }] } });
// Stop recording programs; API calls are still recorded.
await neev.sandboxes.update(id, { execution_trace: false });
```

**`list(params?)`** — `params` is `{ page?, limit?, name?, status?, sandboxId?, labels?, orgId?, projectId? }`; returns `SandboxPage` = `{ items: Sandbox[]; total; page; limit }`. `labels` keeps only sandboxes carrying every given label; each is sent as a repeated `label=key=value` query param, and a malformed one is rejected with `BadRequestError`.

```ts
const { items, total } = await neev.sandboxes.list({ limit: 50 });
const payments = await neev.sandboxes.list({ labels: { team: "payments" } });
```

**`get` / `pause` / `resume` / `delete`**

```ts
const sandbox = await neev.sandboxes.get(id);
await neev.sandboxes.pause(id);
await neev.sandboxes.resume(id);
await neev.sandboxes.delete(id);
```

**`keepalive(id, scope?)` / `updateTimeout(id, windows, scope?)`** — `keepalive` resets the idle timer. `updateTimeout` changes only the windows you pass: `0` turns a window off, and an omitted field is left unchanged.

| Window | Meaning |
| --- | --- |
| `idle_timeout_seconds` | Act after this long with no activity |
| `on_idle` | `"pause"` or `"delete"`; any other value throws before the request |
| `max_lifetime_seconds` | Hard limit on total lifetime |
| `paused_retention_seconds` | How long a paused sandbox is kept |

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

**`audit(id, params?)`** — one page of the audit trail, newest first. See [Audit trail](#audit-trail) for the events and filters.

```ts
let page = await neev.sandboxes.audit(id, { limit: 50 });
while (page.next_cursor) page = await neev.sandboxes.audit(id, { cursor: page.next_cursor });
```

### Audit trail

`audit()` returns `{ from, to, retention_days, window_truncated, next_cursor?, data: AuditEvent[] }`, newest first. Each event is an [OCSF 1.9.0](https://schema.ocsf.io/1.9.0/) event, so it can go straight into a SIEM.

| `class_uid` | `class_name` | What it records | `activity_name` |
| --- | --- | --- | --- |
| `6003` | API Activity | A call made to the sandbox: `exec`, a terminal command, a file operation, a process start, SSH, a code-interpreter cell | Create, Read, Update, Delete, Other |
| `1007` | Process Activity | A program that ran inside the sandbox, whether or not a call asked for it: scripts, generated code, child processes | Launch, Terminate, Sandbox Start |
| `4001` | Network Activity | A connection a program opened | Open |

Every event has `time` (milliseconds since the Unix epoch), `type_name` (such as `Process Activity: Launch`), `status` (`Success` or `Failure`), `device.uid` (the sandbox id) and `metadata.uid` (a stable event id).

| Class | Key fields |
| --- | --- |
| API Activity | `api.operation`, `api.request.uid`, `actor.user` (`type` is `User`, `API Key`, `System` or `Unknown`; an API key also has `programmatic_credentials[].uid`), `resources[]`, `duration`, `status_code` |
| Process Activity | `process.pid`, `process.name` (no arguments), `process.file.path` (what actually executed), `process.working_directory`, `process.parent_process.pid`. On Launch, `actor.process` is the parent. On Terminate, `exit_code`, or `status_detail` such as `signal 9` when a signal stopped it |
| Network Activity | `actor.process` (the program), `dst_endpoint.ip` and `dst_endpoint.port`, or `dst_endpoint.name` (`unix:<path>`) for a local socket |

Program and connection events don't name who acted. To find the call that started a program, take the API Activity event whose `resources[].data.pid` equals the program's pid, or the pid of an ancestor reached through `parent_process.pid` (each ancestor's own Launch event names its parent). A terminal command's programs lead back to the terminal's shell pid.

| Filter | Applies to |
| --- | --- |
| `from`, `to` (RFC 3339), `limit` (1–200, default 50), `cursor` | Every event |
| `status` (`"success"` or `"failure"`) | Every event |
| `operation` (one name or an array) | API Activity only; programs and connections are left out |
| `actorType`, `actorUid`, `credentialUid` | API Activity only |
| `orgId`, `projectId` | Overrides the client's scope for this call |

- Program names are recorded without their arguments, the environment is never recorded, and input typed at a hidden password prompt is never recorded.
- Programs and connections can take about a minute to appear. The first programs a newly started sandbox runs may be missing.
- `update(id, { execution_trace: false })` stops recording programs and connections; calls are still recorded. `sandbox.executionTrace` reports the current setting.
- The trail covers the last `retention_days` days; `window_truncated` is `true` when `from` reaches further back.

[examples/audit-trail.ts](../examples/audit-trail.ts) prints all three classes and ties each program to the call that started it.

### Templates

Read-only catalogue. A template id (e.g. `"sb-ubuntu-26-04-dev"`) is optional at create time; use this resource to discover valid ids.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `list(params?)` | `Promise<SandboxTemplatePage>` | Lists available templates with pagination (active and deprecated only). |
| `get(id)` | `Promise<SandboxTemplate>` | Fetches a single template by id. |

```ts
const { items } = await neev.templates.list({ limit: 10 });
const template = await neev.templates.get("sb-ubuntu-26-04-dev");
```

Templates you can start from:

| Template | Use it for |
| --- | --- |
| `sb-ubuntu-26-04-dev` | General development: git, gh, Python 3, Node 24 LTS |
| `sb-ubuntu-26-04-docker` | Docker, Compose and Buildx, with Docker started at boot; run containers with `--network=host` |
| `sb-ubuntu-26-04-interpreter` | The [code interpreter](#code-interpreter): Python kernels that keep their state |
| `sb-ubuntu-26-04-playwright` | Browser testing: a desktop with Node 24, Playwright and Chromium, headless or headed (`DISPLAY=:1`) |

The catalogue grows over time, so `templates.list()` is the source of truth.

### Snapshots, fork and rollback

Snapshots capture a sandbox's filesystem state, and they are **asynchronous**. `createSnapshot` and `sandbox.snapshot` return a snapshot with `status: "Pending"`, and it must reach `"Ready"` before you can roll back to it or fork from it.

- Status values: `"Pending" | "Running" | "Ready" | "Failed"`.
- To wait for `Ready`, pass `{ waitUntilReady: true }` to `sandbox.snapshot`, or call `waitForSnapshot(snapshotId)`.
- Both resolve with the `Ready` snapshot, and throw if the capture fails or the timeout passes.

Two distinct paths:

- **`rollback(id, snapshotId)`** — rolls the **same** sandbox in place back to a **chosen** snapshot.
- **`fork(id, name)`** — atomically snapshots the source's **current live state** into a **brand-new** sandbox; it does **not** reuse an existing snapshot, and the source keeps running.

```ts
const sandbox = await neev.sandboxes.get(id);

// Capture the full state and block until it is Ready.
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

### Sandbox handle

`Sandbox` instances are returned by `create()`, `get()`, and `list().items`. They carry the last-known server state and expose lifecycle and runtime actions that operate on this sandbox in place. Construct via the `sandboxes` resource, never directly.

#### Getters

| Getter | Type | Summary |
| ------ | ---- | ------- |
| `id` | `string` | Sandbox UUID. |
| `name` | `string` | Human-readable name. |
| `phase` | `SandboxPhase` | Lifecycle phase as last seen (e.g. `"Pending"`, `"Ready"`, `"Paused"`). |
| `region` | `string` | Region slug the sandbox runs in. |
| `templateId` | `string \| null` | Template id it was created from, or `null`. |
| `resources` | `SandboxResources \| undefined` | Provisioned compute size, or `undefined` when defaulted. |
| `labels` | `SandboxLabels` | Labels set at create time; `{}` when the sandbox has none. |
| `connectUrl` | `string \| null` | Runtime address, or `null` when not yet configured. |
| `addressable` | `boolean` | Whether the sandbox can be reached yet; briefly `false` after create. `waitUntilReady` and runtime calls wait for it. |
| `executionTrace` | `boolean` | Whether every program the sandbox runs is recorded in its audit trail. `true` unless turned off. |
| `lastCrash` | `SandboxLastCrash \| null` | Most recent unexpected stop, or `null` if the sandbox has never had one. `storage_reset: true` means it restarted with an empty filesystem — files under `/workspace`, and anything installed since create, are gone. Historical: not cleared when the sandbox recovers; restoring from a snapshot taken before that stop brings the files back and clears it. |
| `data` | `SandboxData` | Full raw API record. |

#### Methods

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `waitUntilReady(options?)` | `Promise<this>` | Polls until phase is `"Ready"` and the sandbox is addressable. Throws fast if `"Paused"`, or on timeout. |
| `refresh()` | `Promise<this>` | Re-fetches the record and updates the handle in place. |
| `update(params)` | `Promise<this>` | Updates in place (`resources`, `egress`, `egress_add` / `egress_remove`, or `execution_trace`) and updates the handle. |
| `pause()` | `Promise<this>` | Pauses (stops running, keeps state) and updates the handle. |
| `resume()` | `Promise<this>` | Resumes from the kept state and updates the handle. |
| `keepalive()` | `Promise<this>` | Resets the idle timer and updates the handle. |
| `updateTimeout(windows)` | `Promise<this>` | Changes the idle/lifetime windows (seconds) and updates the handle. |
| `delete()` | `Promise<void>` | Permanently deletes the sandbox. |
| `metrics(params?)` | `Promise<SandboxMetricsResponse>` | Reads the live metric series; `params` is `{ from?, to?, step? }`. |
| `audit(params?)` | `Promise<AuditTrail>` | Reads one page of the audit trail. See [Audit trail](#audit-trail). |
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

### Commands and processes

Runtime APIs run commands and work with files **inside** a sandbox. Use `sandbox.exec`, `sandbox.files` and the other runtime properties on the handle; the first call waits until the sandbox is `Ready`.

- File paths are relative to the workspace, or absolute inside it. A path outside the workspace is refused.
- Runtime calls are **not retried**, because a retried `write` or `exec` could run twice.
- The exception is a chunked upload: a failed chunk resumes from the last byte the sandbox received.

#### Exec

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

#### `sandbox.processes`

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

### Files

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
const head = await sandbox.files.read("big.log", { offset: 0, length: 4096 }); // → first 4 KiB only
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

### Terminals and SSH

#### `sandbox.pty`

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

#### `sandbox.ssh`

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

### Code interpreter

Sandboxes created from `sb-ubuntu-26-04-interpreter` run Python in kernels that keep their state between runs. `sandbox.code` runs code in them; the first call waits until the sandbox is `Ready`.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `run(code, options?)` | `Promise<Execution>` | Runs code in a context (the `default` one unless `options.context` is set) and returns its output, results and how it ended. An exception in the code is returned in `error`, not thrown. |
| `createContext(options?)` | `Promise<CreatedCodeContext>` | Starts a separate kernel with its own state; `options` = `{ language?, cwd? }`. |
| `listContexts(options?)` | `Promise<CodeContext[]>` | Lists contexts with their `state`, `generation` and memory use (`rssMib`). |
| `restartContext(context, options?)` | `Promise<string>` | Restarts a context's kernel, dropping its state; returns the new `generation`. |
| `deleteContext(context, options?)` | `Promise<void>` | Stops a context and frees its kernel. |

`run` options: `context`, `language`, `envs` (for this run only), `timeoutMs` (the cell's limit), `requestTimeoutMs` (a bound on the whole call), `signal`, and the `onStdout` / `onStderr` / `onResult` callbacks. An `Execution` has `stdout`, `stderr`, `logs`, `results`, `text` (the last expression's value), `error`, `endReason`, `executionCount` and `generation`; a changed `generation` means the context's state was lost.

```ts
await sandbox.code.run("import pandas as pd\ndf = pd.DataFrame({'x': [1, 2, 3]})");
const run = await sandbox.code.run("int(df.x.sum())");
console.log(run.text, run.endReason); // "6" "ok"

const ctx = await sandbox.code.createContext({ cwd: "project" });
await sandbox.code.run("import os; print(os.getcwd())", { context: ctx });
```

### Low-level connection types

Listed for completeness; prefer the handle methods above.

| Type | Summary |
| ---- | ------- |
| `SandboxConnection` | A live connection to one sandbox's runtime. Construct via `neev.createSandboxConnection(connectUrl)`, or reach it through `sandbox.exec` / `sandbox.files` / `sandbox.processes` / `sandbox.pty`. Exposes `exec`, `execStream`, and `files` / `processes` / `pty` facades. |
| `SandboxFiles` | The filesystem facade (`write`/`upload`/`read`/`readText`/`list`/…). Accessed via `sandbox.files` or `connection.files`. |
| `SandboxProcesses` | The process-supervisor facade (`start`/`get`/`list`/`kill`/`killAll`/`logs`/`follow`). Accessed via `sandbox.processes` or `connection.processes`. |
| `SandboxPty` | The interactive-terminal facade (`create` → `PtyHandle`). Accessed via `sandbox.pty` or `connection.pty`. |

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
| `audit(id, params?)` | `Promise<AuditTrail>` | Reads one page of what the agent ran in its sandbox. See [Audit trail](#audit-trail). |
| `delete(id, scope?)` | `Promise<void>` | Permanently deletes the agent and its backing sandbox. |

**`create(params, scope?)`** — `params` is `CreateAgentParams`.

| Field | Notes |
| --- | --- |
| `name`, `agent_template` | Required |
| `config` | Overrides the template's `default_config` |
| `resources`, `egress`, `allowInternet`, `allowEgress` | As on `neev.sandboxes.create` |
| `idle_timeout_seconds` | Omit for the account default; `0` means no idle limit (the agent then holds quota until it is deleted) |

**`update(id, params, scope?)`** — `params` is `UpdateAgentParams`: the same `resources`, `egress`, `egress_add` and `egress_remove` rules as `neev.sandboxes.update`, plus `idle_timeout_seconds` (`0` removes the idle limit).

- Pass at least one of `resources`, `egress`, `egress_add`, `egress_remove` or `idle_timeout_seconds`.
- `egress_add` / `egress_remove` can't be combined with `egress`.
- Either mistake throws `NeevError` before any request is sent.

```ts
const agent = await neev.agents.create({ name: "reviewer", agent_template: "claude-code", idle_timeout_seconds: 900 });
await agent.waitUntilReady();

await neev.agents.update(agent.id, { egress_add: { allow: [{ host: "api.github.com", ports: [443] }] } });
await neev.agents.keepalive(agent.id);              // e.g. once per agent turn
const port = await neev.agents.exposePort(agent.id, 3000);
const trail = await neev.agents.audit(agent.id, { limit: 50 });
```

The agent audit trail has the same events, filters and recording rules as the [sandbox one](#audit-trail). An agent has no `execution_trace` setting.

### Agent templates

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
| `audit(params?)` | `Promise<AuditTrail>` | One page of the audit trail. See [Audit trail](#audit-trail). |
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

## Agent tools

### The tool contract

`@neevcloud/sdk/agent-tools` is the sandbox tool contract for agents you build on any framework. Declare the enabled tools with `DESCRIPTIONS` and `PARAMETERS` (JSON Schema), plus `TITLES` for display, then pass each tool call to `call(name, args)`. Full symbol list: [api-inventory.md](./api-inventory.md#agent-tools).

| Tool | Method | Opt-in |
| ---- | ------ | ------ |
| `run_command` | `runCommand({ command, cwd?, timeout_s? })` | — |
| `write_file` | `writeFile({ path, content })` | — |
| `read_file` | `readFile({ path, offset?, length? })` | — |
| `stat_path` | `statPath({ path })` | — |
| `move_path` | `movePath({ source, destination })` | — |
| `delete_path` | `deletePath({ path, recursive? })` | — |
| `expose_port` | `exposePort({ port })` | `allowPreview` |
| `checkpoint` / `rollback` | `checkpoint({ label? })` / `rollback({ checkpoint_id })` | `allowRollback` |
| `start_process` / `read_process_output` / `stop_process` / `list_processes` | `startProcess({ command, cwd? })` / `readProcessOutput({ process_id, cursor?, wait_s? })` / `stopProcess({ process_id })` / `listProcesses()` | `allowProcesses` |

```ts
import { DESCRIPTIONS, PARAMETERS, SandboxTools } from "@neevcloud/sdk/agent-tools";

const tools = new SandboxTools(sandbox, { allowProcesses: true });
const specs = tools.names().map((name) => ({ name, description: DESCRIPTIONS[name], parameters: PARAMETERS[name] }));
const result = await tools.call("run_command", { command: "npm test", timeout_s: 120 });
```

`tools.specs()` returns one `{ name, title, description, parameters, call(args) }` per enabled tool. `FatalGuard` wraps those calls for a framework that would hand a thrown error to the model: `guard.call(spec, args)` answers a throw with `{ error: FATAL_ERROR }`, records the first error and aborts `guard.signal`, and stops running tools after that, and `guard.raiseIfFailed()` rethrows it.

### Framework adapters

| Subpath | Export | Framework (optional peer) |
| ------- | ------ | ------------------------- |
| `@neevcloud/sdk/agent-tools/claude` | `toClaude(tools)` → `{ options(), watch(query), guard }` | `@anthropic-ai/claude-agent-sdk` ^0.3.142, `zod` 4.2 or later |
| `@neevcloud/sdk/agent-tools/openai-agents` | `toOpenAIAgents(tools)` → `FunctionTool[]` | `@openai/agents` ^0.20.0 (Node 20+) |
| `@neevcloud/sdk/agent-tools/ai-sdk` | `toAiSdk(tools)` → `{ tools, guard }` | `ai` 5, 6 or 7 |

Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` and `zod` 4.2 or later): the tools run in-process as an MCP server, Claude Code's own tools are switched off, and `watch` stops the run and throws if a sandbox call fails.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { toClaude } from "@neevcloud/sdk/agent-tools/claude";

const claude = toClaude(new SandboxTools(sandbox));
for await (const msg of claude.watch(query({ prompt, options: { ...claude.options(), maxTurns: 12 } }))) {
  if (msg.type === "result") console.log(msg.result);
}
```

OpenAI Agents SDK (`@openai/agents`): a sandbox call that throws ends `Runner.run`.

```ts
import { Agent, run } from "@openai/agents";
import { toOpenAIAgents } from "@neevcloud/sdk/agent-tools/openai-agents";

const agent = new Agent({ name: "coder", tools: toOpenAIAgents(new SandboxTools(sandbox)) });
const result = await run(agent, prompt);
```

Vercel AI SDK (`ai`): pass the guard's signal, and call `raiseIfFailed()` after the run so a failed sandbox call surfaces instead of the abort.

```ts
import { generateText, stepCountIs } from "ai";
import { toAiSdk } from "@neevcloud/sdk/agent-tools/ai-sdk";

const { tools, guard } = toAiSdk(new SandboxTools(sandbox));
try {
  const { text } = await generateText({ model, tools, prompt, stopWhen: stepCountIs(12), abortSignal: guard.signal });
} finally {
  guard.raiseIfFailed();
}
```

---

## Errors

Every failure is a `NeevError` subclass, so branch on `instanceof` rather than on the message text.

| Field on `APIError` | Meaning |
| --- | --- |
| `status` | The HTTP status |
| `code` | A machine-readable `ErrorCode`, such as `not_found`, `validation_error` or `sandbox_quota_exceeded` |
| `scope` | For a quota refusal, which limit was hit: `organization` or `project` |
| `details` | Extra detail from the response, when present |
| `requestId` | Include this when you contact support |

Errors from inside a sandbox (files, exec, processes) carry the sandbox's reason code in `code`, such as `not_found`, `invalid_argument` or `permission_denied`.

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

### Sandbox lifecycle

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
| `neev.templates.get(id)` | `const tpl = await neev.templates.get("sb-ubuntu-26-04-dev");` |
| `neev.agents.create(...)` | `const agent = await neev.agents.create({ name: "reviewer", agent_template: "claude-code" });` |
| `neev.agents.keepalive(id)` | `await neev.agents.keepalive(id);` |
| `neev.agents.rollback(id, snapshotId)` | `await neev.agents.rollback(id, snapshotId);` |
| `neev.agents.audit(id, ...)` | `const trail = await neev.agents.audit(id, { limit: 50 });` |
| `neev.agentTemplates.list(...)` | `const { items } = await neev.agentTemplates.list();` |
| `agent.getUrl(...)` | `const url = await agent.getUrl({ port: 3000 });` |
| `agent.sandbox()` | `const sandbox = await agent.sandbox();` |
| `neev.raw.request(...)` | `const data = await neev.raw.request<T>({ method: "GET", path });` |
| `sandbox.id` / `.name` / `.phase` | `console.log(sandbox.phase);` |
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
| `sandbox.audit(...)` | `const { data, next_cursor } = await sandbox.audit({ limit: 50 });` |
| `sandbox.addressable` | `console.log(sandbox.addressable);` |
| `sandbox.getUrl(...)` | `const url = await sandbox.getUrl({ port: 3000 });` |
| `sandbox.exposePort(...)` | `const p = await sandbox.exposePort(3000, { slug: "k3x9q2ab" });` |
| `sandbox.toJSON()` | `JSON.stringify(sandbox);` |

### Inside a sandbox

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
