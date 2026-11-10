# API reference

Every public method in `@neevcloud/sdk`, grouped by product, with copy-paste snippets.
Every method is async: `await` it. For a guided tour, see the product guides
([Sandboxes](./sandboxes.md), [Agents](./agents.md), [Agent tools](./agent-tools.md)); to
get set up, see [Getting started](./getting-started.md). For every exported type and
field, see the [API inventory](./api-inventory.md).

## Contents

- [Client](#client): [`new Neev`](#new-neevoptions), [Per-call scope](#per-call-scope), [`neev.raw`](#neevraw)
- [Sandboxes](#sandboxes)
  - [`neev.sandboxes`](#neevsandboxes): `create`, `list`, `get`, `update`, `pause`, `resume`, `keepalive`, `updateTimeout`, `delete`, `metrics`, `audit`, ports, snapshots, `rollback`, `fork`
  - [Templates](#templates): `neev.templates.list`, `get`
  - [Snapshots, fork and rollback](#snapshots-fork-and-rollback)
  - [Audit trail](#audit-trail)
  - [Sandbox handle](#sandbox-handle)
  - [Commands and processes](#commands-and-processes): `exec`, `sandbox.processes`
  - [Files](#files): `sandbox.files`
  - [Terminals and SSH](#terminals-and-ssh): `sandbox.pty`, `sandbox.ssh`
  - [Code interpreter](#code-interpreter): `sandbox.code`
  - [Low-level connection](#low-level-connection)
- [Agents](#agents): [`neev.agents`](#neevagents), [Agent templates](#agent-templates), [`Agent` handle](#agent-handle)
- [Agent tools](#agent-tools): [The tool contract](#the-tool-contract), [Framework adapters](#framework-adapters)
- [Errors](#errors)

---

## Client

### `new Neev(options?)`

Construct one `Neev` instance and reuse it. The resource namespaces (`sandboxes`,
`templates`, `agents`, `agentTemplates`, `raw`) hang off the instance. Every option is
optional and falls back to a `NEEV_*` environment variable.

```ts
import { Neev } from "@neevcloud/sdk";

const neev = new Neev({
  apiKey: process.env.NEEV_API_KEY,
  orgId: process.env.NEEV_ORG_ID,
  projectId: process.env.NEEV_PROJECT_ID,
});
```

| Option | Env var | Default | Notes |
| ------ | ------- | ------- | ----- |
| `apiKey` | `NEEV_API_KEY` | | Required. The constructor throws `NeevError` if unset. |
| `orgId` | `NEEV_ORG_ID` | | Required at call time; overridable per call. |
| `projectId` | `NEEV_PROJECT_ID` | | Required at call time; overridable per call. |
| `baseURL` | `NEEV_BASE_URL` | `https://api.ai.neevcloud.com/agent` | API base URL. |
| `timeoutMs` | | `60000` | Per-attempt timeout until the response starts. |
| `maxRetries` | | `2` | Retries on network errors, `429` and `5xx`, for lifecycle calls only. |
| `fetch` | | global `fetch` | Custom fetch implementation. |
| `webSocket` | | global `WebSocket` | Factory for terminal sessions. In Node, pass one built on the `ws` package. |

The client holds no persistent connections, so there is no `close()`. See
[Configuration](./configuration.md) for timeouts, retries and runtimes.

### Per-call scope

Sandbox and agent methods take an optional `Scope` (`{ orgId?, projectId? }`) to target
another organization or project for one call: inside the params object for `list`,
`metrics`, `audit`, `listSnapshots`, `waitForSnapshot` and `exposePort`, and as a trailing
argument elsewhere. A handle keeps the scope it was fetched with.

```ts
await neev.sandboxes.list({ orgId: "other-org", projectId: "other-project" });
await neev.sandboxes.pause("web", { orgId: "other-org", projectId: "other-project" });
```

### `neev.raw`

Untyped escape hatch for an endpoint the SDK does not wrap yet. Shares the lifecycle
transport: authentication, timeout, retries and typed errors.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `request<T>(req)` | `Promise<T>` | Sends `{ method, path, query?, body?, signal? }`; `path` is relative to `baseURL`, `body` is sent as JSON, and an empty response resolves to `undefined`. |

```ts
const widget = await neev.raw.request<{ id: string }>({
  method: "GET",
  path: "/api/v1beta1/orgs/acme/projects/web/widgets/123",
});
```

---

## Sandboxes

A sandbox is an isolated machine for your code. `neev.sandboxes` and `neev.templates`
manage sandboxes; the `Sandbox` handle and its runtime properties work inside one. Guide:
[Sandboxes](./sandboxes.md).

### `neev.sandboxes`

Every method that returns a sandbox returns a `Sandbox` handle (or a page of handles), so
you can chain lifecycle actions on the result. Every method that takes an `id` accepts a
name too.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `create(params, scope?)` | `Promise<Sandbox>` | Creates a sandbox. The handle may still be `Pending`; call `waitUntilReady`. |
| `list(params?)` | `Promise<SandboxPage>` | Lists sandboxes, one page at a time, as handles. |
| `get(id, scope?)` | `Promise<Sandbox>` | Fetches a sandbox by id or name. |
| `update(id, params, scope?)` | `Promise<Sandbox>` | Updates a running sandbox in place: `resources`, `egress`, `egress_add` / `egress_remove`, or `execution_trace`. At least one is required. |
| `pause(id, scope?)` | `Promise<Sandbox>` | Pauses a sandbox: it stops running and keeps its state. |
| `resume(id, scope?)` | `Promise<Sandbox>` | Resumes a paused sandbox from its kept state. |
| `keepalive(id, scope?)` | `Promise<Sandbox>` | Resets the idle timer. |
| `updateTimeout(id, windows, scope?)` | `Promise<Sandbox>` | Changes the idle and lifetime windows (seconds); only the fields passed change. |
| `delete(id, scope?)` | `Promise<void>` | Permanently deletes a sandbox and its snapshots. |
| `metrics(id, params?)` | `Promise<SandboxMetricsResponse>` | Reads CPU, memory and disk series over an optional window. |
| `audit(id, params?)` | `Promise<AuditTrail>` | Reads one page of the audit trail, newest first. See [Audit trail](#audit-trail). |
| `exposePort(id, port, params?)` | `Promise<SandboxPort>` | Exposes a port for a preview URL; `params.slug` chooses or rotates the URL's slug. |
| `listPorts(id, scope?)` | `Promise<SandboxPort[]>` | Lists the exposed preview ports. |
| `revokePort(id, port, scope?)` | `Promise<void>` | Stops serving a preview port. Revoking a port that isn't exposed succeeds. |
| `getPortUrl(id, port, options?, scope?)` | `Promise<string>` | Exposes a port and returns its preview URL once routable; `options` = `{ slug?, waitUntilReady?, timeoutMs?, pollIntervalMs? }`. |
| `createSnapshot(id, params?, scope?)` | `Promise<SnapshotData>` | Captures a snapshot; returns at once with `status: "Pending"`. |
| `listSnapshots(id, params?)` | `Promise<SnapshotPage>` | Lists a sandbox's snapshots; accepts `{ page, limit }`. |
| `getSnapshot(snapshotId, scope?)` | `Promise<SnapshotData>` | Fetches a snapshot by id. |
| `waitForSnapshot(snapshotId, params?)` | `Promise<SnapshotData>` | Polls until the snapshot is `Ready`; throws on `Failed` (with its error message) or on timeout. |
| `deleteSnapshot(snapshotId, scope?)` | `Promise<void>` | Deletes a snapshot. |
| `rollback(id, snapshotId, scope?)` | `Promise<Sandbox>` | Rolls a sandbox back in place to one of its snapshots. |
| `fork(id, name, scope?)` | `Promise<Sandbox>` | Forks a sandbox's current live state into a new named sandbox. |

**`create(params, scope?)`**: every field is optional.

| Field | Notes |
| --- | --- |
| `name` | Generated when omitted |
| `sandbox_template_id` | A catalogue template; omit for the default. Set at most one of this and `image` |
| `image`, `command` | Bring your own image: a public OCI image with a tag or digest, and an optional start command |
| `restore` | A snapshot id to start from instead of a template. `from_snapshot` is a deprecated alias |
| `resources` | `cpu`, `memory_gb`, `disk_gb`, and `rootfs_disk_gb` (create only); omitted fields take the default (see [`SandboxResources`](./api-inventory.md#sandboxresources)) |
| `env` | Environment variables, as `[{ name, value }]` |
| `region` | Omit for the default |
| `allowInternet`, `allowEgress` | Open outbound network; a sandbox's egress is deny-all by default |
| `egress` | A full egress policy; takes precedence over the two fields above |
| `lifecycle` | `idle_timeout_seconds`, `on_idle`, `max_lifetime_seconds`, `paused_retention_seconds`; omit for account defaults. An invalid `on_idle` throws before the request |
| `labels` | Up to 16 key-value pairs that `list` can filter on; a malformed label is rejected with `BadRequestError` |

```ts
const sandbox = await neev.sandboxes.create({ sandbox_template_id: "sb-ubuntu-26-04-dev" });
await sandbox.waitUntilReady();

await neev.sandboxes.create({ name: "web", allowInternet: true });
await neev.sandboxes.create({ name: "ci", allowEgress: ["github.com", "*.npmjs.org"] });
await neev.sandboxes.create({ image: "docker.io/library/python:3.12-slim", command: ["sleep", "infinity"] });
await neev.sandboxes.create({ lifecycle: { idle_timeout_seconds: 600, max_lifetime_seconds: 7200, on_idle: "pause" } });
await neev.sandboxes.create({ labels: { team: "payments", "ci-run": "4821" } });
```

**`update(id, params, scope?)`** changes a running sandbox in place and returns the
updated handle. The id, name and preview URLs stay the same.

| Field | Effect |
| --- | --- |
| `resources` | Resize CPU and memory in place. `disk_gb` can't be resized; the server rejects it |
| `egress` (or `allowInternet` / `allowEgress`) | Replace the egress policy in full. New connections use it at once, with no restart |
| `egress_add`, `egress_remove` | Edit the existing allow-list in place (`{ allow: SandboxEgressRule[] }`). Removals apply first, so one call can swap a host. `egress_add` needs the sandbox to already be in `allow_list` mode |
| `execution_trace` | `false` stops recording programs and connections in the audit trail; `true` turns it back on. No restart |

Pass at least one field. `egress_add` / `egress_remove` can't be combined with `egress`
or the convenience fields. An empty or conflicting update throws `NeevError` before any
request is sent.

```ts
await neev.sandboxes.update(id, { resources: { cpu: 2, memory_gb: 4 } });
await neev.sandboxes.update(id, { resources: { cpu: 4 }, allowEgress: ["api.github.com"] });
await neev.sandboxes.update(id, { egress_add: { allow: [{ host: "pypi.org", ports: [443] }] } });
await neev.sandboxes.update(id, { execution_trace: false });
```

**`list(params?)`**: `params` is `{ page?, limit?, name?, status?, sandboxId?, labels?, orgId?, projectId? }`
and returns `{ items: Sandbox[]; total; page; limit }`. `name` is a case-insensitive
substring match, and `labels` keeps only sandboxes carrying every given label.

```ts
const { items, total } = await neev.sandboxes.list({ status: "Paused", limit: 50 });
const payments = await neev.sandboxes.list({ labels: { team: "payments" } });
```

**`keepalive(id, scope?)` / `updateTimeout(id, windows, scope?)`**: `keepalive` resets
the idle timer. `updateTimeout` changes only the windows you pass; `0` turns a window off.

| Window | Meaning |
| --- | --- |
| `idle_timeout_seconds` | Act after this long with no activity |
| `on_idle` | `"pause"` or `"delete"`; any other value throws before the request |
| `max_lifetime_seconds` | Hard limit on total lifetime |
| `paused_retention_seconds` | How long a paused sandbox is kept |

```ts
await neev.sandboxes.keepalive(id);
await neev.sandboxes.updateTimeout(id, { idle_timeout_seconds: 600, on_idle: "pause" });
await neev.sandboxes.updateTimeout(id, { max_lifetime_seconds: 0 });
```

**`metrics(id, params?)`**: `params` is `{ from?, to?, step?, orgId?, projectId? }`;
`from` and `to` are RFC 3339, `step` is a duration such as `"60s"`. The window defaults to
the last hour.

```ts
const metrics = await neev.sandboxes.metrics(id, { step: "60s" });
```

**Preview ports**

```ts
const url = await neev.sandboxes.getPortUrl(id, 3000);
const port = await neev.sandboxes.exposePort(id, 3000, { slug: "k3x9q2ab" }); // { port, slug, preview_url }
const ports = await neev.sandboxes.listPorts(id);
await neev.sandboxes.revokePort(id, 3000);
```

### Templates

Read-only catalogue of sandbox templates. Pass a template's id as `sandbox_template_id` at
create time.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `neev.templates.list(params?)` | `Promise<SandboxTemplatePage>` | Lists templates, `{ page?, limit? }`, active and deprecated only. |
| `neev.templates.get(id)` | `Promise<SandboxTemplate>` | Fetches one template by id. |

```ts
const { items } = await neev.templates.list({ limit: 10 });
const template = await neev.templates.get("sb-ubuntu-26-04-dev");
```

| Template | Use it for |
| --- | --- |
| `sb-ubuntu-26-04-dev` | General development: git, gh, Python 3, Node 24 LTS |
| `sb-ubuntu-26-04-docker` | Docker, Compose and Buildx, with Docker started at boot; run containers with `--network=host` |
| `sb-ubuntu-26-04-interpreter` | The [code interpreter](#code-interpreter): Python kernels that keep their state |
| `sb-ubuntu-26-04-playwright` | Browser testing: a desktop with Node 24, Playwright and Chromium, headless or headed (`DISPLAY=:1`) |

### Snapshots, fork and rollback

A snapshot captures a sandbox's full state, its files and the memory of its running
processes, unless you pass `snapshot_type: "filesystem"`, which captures `/workspace` only
and restores onto any sandbox image. Snapshots are asynchronous: `createSnapshot` and
`sandbox.snapshot` return one with `status: "Pending"`, and it must reach `"Ready"` before
you roll back to it or restore it.

- Status values: `"Pending" | "Running" | "Ready" | "Failed"`. `trigger` is `"manual"` or
  `"memory_pressure"`.
- To wait, pass `{ waitUntilReady: true }` to `sandbox.snapshot`, or call
  `waitForSnapshot(snapshotId)`. Both resolve with the `Ready` snapshot and throw if the
  capture fails or the timeout passes.
- **`rollback(id, snapshotId)`** rolls the same sandbox back in place to a chosen snapshot.
- **`fork(id, name)`** snapshots the source's current live state into a new sandbox; it
  does not reuse an existing snapshot, and the source keeps running.
- **`create({ restore: snapshotId })`** starts a new sandbox from a snapshot.

```ts
const snap = await sandbox.snapshot({ name: "checkpoint", waitUntilReady: true });
await sandbox.rollback(snap.id);
const fork = await sandbox.fork("my-fork");
const restored = await neev.sandboxes.create({ restore: snap.id });

const { items } = await neev.sandboxes.listSnapshots(id, { page: 1, limit: 20 });
await neev.sandboxes.deleteSnapshot(snap.id);

const pending = await sandbox.snapshot({ name: "later" }); // status: "Pending"
const ready = await neev.sandboxes.waitForSnapshot(pending.id); // resolves once Ready
```

`waitForSnapshot(snapshotId, params?)` takes `{ timeoutMs? (default 300000), pollIntervalMs? (default 2000), orgId?, projectId? }`.
`sandbox.snapshot(options?)` takes `name`, `snapshot_type`, `waitUntilReady`, `timeoutMs`
and `pollIntervalMs`. `listSnapshots` and `sandbox.snapshots()` return
`{ items: SnapshotData[]; total; page; limit }`.

### Audit trail

`audit()` returns `{ from, to, retention_days, window_truncated, next_cursor?, data: AuditEvent[] }`,
newest first. Each event is an [OCSF 1.9.0](https://schema.ocsf.io/1.9.0/) event, so it can
go straight into a SIEM.

| `class_uid` | `class_name` | What it records | `activity_name` |
| --- | --- | --- | --- |
| `6003` | API Activity | A call made to the sandbox: `exec`, a terminal command, a file operation, a process start, SSH, a code-interpreter cell | Create, Read, Update, Delete, Other |
| `1007` | Process Activity | A program that ran inside the sandbox, whether or not a call asked for it: scripts, generated code, child processes | Launch, Terminate, Sandbox Start |
| `4001` | Network Activity | A connection a program opened | Open |

Every event has `time` (milliseconds since the Unix epoch), `type_name` (such as
`Process Activity: Launch`), `status` (`Success` or `Failure`), `actor`, `device.uid` (the
sandbox id), `cloud.org` and `metadata.uid` (a stable event id). `api` and `resources` are
set on API Activity events only, so read `e.api?.operation`.

| Class | Key fields |
| --- | --- |
| API Activity | `api.operation`, `api.request.uid`, `actor.user` (`type` is `User`, `API Key`, `System` or `Unknown`; an API key also has `programmatic_credentials[].uid`), `resources[]`, `duration`, `status_code` |
| Process Activity | `process.pid`, `process.name` (no arguments), `process.file.path` (what actually executed), `process.working_directory`, `process.parent_process.pid`. On Launch, `actor.process` is the parent. On Terminate, `exit_code`, or `status_detail` such as `signal 9` when a signal stopped it |
| Network Activity | `actor.process` (the program), `dst_endpoint.ip` and `dst_endpoint.port`, or `dst_endpoint.name` (`unix:<path>`) for a local socket |

Program and connection events don't name who acted. To find the call that started a
program, take the API Activity event whose `resources[].data.pid` equals the program's
pid, or the pid of an ancestor reached through `parent_process.pid`. A terminal command's
programs lead back to the terminal's shell pid.

| Filter | Applies to |
| --- | --- |
| `from`, `to` (RFC 3339; default the last 24 hours), `limit` (1 to 200, default 50), `cursor` | Every event |
| `status` (`"success"` or `"failure"`) | Every event |
| `operation` (one name or an array) | API Activity only; programs and connections are left out |
| `actorType`, `actorUid`, `credentialUid` | API Activity only |
| `orgId`, `projectId` | Overrides the client's scope for this call |

```ts
let page = await neev.sandboxes.audit(id, { limit: 50, operation: ["exec", "pty_command"] });
while (page.next_cursor) page = await neev.sandboxes.audit(id, { cursor: page.next_cursor });
```

- Program names are recorded without their arguments, the environment is never recorded,
  and input typed at a hidden password prompt is never recorded.
- Programs and connections can take about a minute to appear. The first programs a newly
  started sandbox runs may be missing.
- `update(id, { execution_trace: false })` stops recording programs and connections; calls
  are still recorded. `sandbox.executionTrace` reports the setting.
- The trail covers the last `retention_days` days; `window_truncated` is `true` when `from`
  reaches further back.

[`examples/audit-trail.ts`](../examples/audit-trail.ts) prints all three classes and ties
each program to the call that started it.

### Sandbox handle

`Sandbox` instances come from `create()`, `get()`, `fork()` and `list().items`. They
carry the last-known server state and act on this sandbox in place. Construct them through
`neev.sandboxes`, never directly.

**Getters**

| Getter | Type | Summary |
| ------ | ---- | ------- |
| `id` | `string` | Sandbox UUID. |
| `name` | `string` | Name. |
| `phase` | `SandboxPhase` | `"Pending" \| "Ready" \| "NotReady" \| "Unknown" \| "Pausing" \| "Paused" \| "RestoreFailed"`, as last seen. |
| `region` | `string` | Region the sandbox runs in. |
| `templateId` | `string \| null` | Template it was created from. |
| `resources` | `SandboxResources \| undefined` | Provisioned size. |
| `labels` | `SandboxLabels` | Labels set at create time; `{}` when none. |
| `connectUrl` | `string \| null` | Runtime address, or `null` when not yet set. |
| `addressable` | `boolean` | Whether the sandbox can be reached yet; briefly `false` after create. `waitUntilReady` and runtime calls wait for it. |
| `executionTrace` | `boolean` | Whether programs and connections are recorded in the audit trail. |
| `lastCrash` | `SandboxLastCrash \| null` | Most recent unexpected stop, `{ reason, at, storage_reset }`, or `null`. `storage_reset: true` means it restarted with an empty filesystem. Historical: not cleared when the sandbox recovers; restoring a snapshot taken before that stop clears it. |
| `data` | `SandboxData` | The full API record. |
| `files`, `processes`, `code`, `pty` | facades | Runtime APIs; see below. |

**Methods**

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `waitUntilReady(options?)` | `Promise<this>` | Polls until `"Ready"` and addressable; `options` = `{ timeoutMs? (default 120000), pollIntervalMs? (default 2000) }`. Throws at once on `"Paused"`, or on timeout. |
| `refresh()` | `Promise<this>` | Re-fetches the record and updates the handle. |
| `update(params)` | `Promise<this>` | As `neev.sandboxes.update`. |
| `pause()` / `resume()` | `Promise<this>` | Pause or resume, and update the handle. |
| `keepalive()` / `updateTimeout(windows)` | `Promise<this>` | Reset the idle timer, or change the windows. |
| `delete()` | `Promise<void>` | Permanently deletes the sandbox. |
| `metrics(params?)` | `Promise<SandboxMetricsResponse>` | `params` = `{ from?, to?, step? }`. |
| `audit(params?)` | `Promise<AuditTrail>` | One page of the audit trail. |
| `snapshot(options?)` | `Promise<SnapshotData>` | Captures a snapshot; `{ waitUntilReady: true }` resolves once it is `Ready`. |
| `snapshots(params?)` | `Promise<SnapshotPage>` | Lists this sandbox's snapshots; `{ page, limit }`. |
| `rollback(snapshotId)` | `Promise<this>` | Rolls back in place to a snapshot. |
| `fork(name)` | `Promise<Sandbox>` | Forks the current state into a new sandbox. |
| `getUrl(options)` | `Promise<string>` | Exposes `options.port` and returns its preview URL once routable; `options` = `{ port, slug?, waitUntilReady?, timeoutMs? (default 60000), pollIntervalMs? }`. |
| `exposePort(port, options?)` | `Promise<SandboxPort>` | Exposes a port without waiting. A different `options.slug` on an exposed port rotates its URL. |
| `listPorts()` / `revokePort(port)` | `Promise<SandboxPort[]>` / `Promise<void>` | List or close preview ports. |
| `exec(command, options?)` | `Promise<ExecResult>` or `AsyncGenerator<ExecStreamEvent>` | Runs a command. See [Commands and processes](#commands-and-processes). |
| `execStream(command, options?)` | `AsyncGenerator<ExecStreamEvent>` | Deprecated alias for `exec(command, { stream: true })`. |
| `ssh(options?)` | `Promise<SshTunnel>` | Opens a local SSH tunnel. Node only. See [Terminals and SSH](#terminals-and-ssh). |
| `toJSON()` | `SandboxData` | The raw record, so `JSON.stringify(sandbox)` emits the API shape. |

The first runtime call (`exec`, `files`, `processes`, `code`, `pty`, `ssh`) waits until the
sandbox is `Ready`. On a `Paused` sandbox that still has a `connectUrl`, the call is sent
and wakes it where the platform's automatic wake-up is enabled; otherwise it fails with
`RateLimitError`, and you call `resume()` and retry. See
[Pause and wake](./sandboxes.md#pause-and-wake).

```ts
const sandbox = await neev.sandboxes.get("web");
await sandbox.waitUntilReady({ timeoutMs: 120_000 });
console.log(sandbox.id, sandbox.phase, sandbox.connectUrl, sandbox.labels);
await sandbox.refresh();
```

### Commands and processes

Runtime calls run inside the sandbox. They are not retried, because a retried `write` or
`exec` could run twice; the exception is a chunked upload, which resumes from the last
byte the sandbox received.

#### `sandbox.exec`

`exec` buffers by default and resolves to an `ExecResult`. Pass `{ stream: true }` to get
a live `AsyncGenerator<ExecStreamEvent>` instead. A non-zero exit code is reported, never
thrown.

```ts
exec(command: string | string[], options?: ExecOptions): Promise<ExecResult>
exec(command: string | string[], options: ExecOptions & { stream: true }): AsyncGenerator<ExecStreamEvent>
```

`ExecOptions` is `{ args?, cwd?, env?, timeoutMs?, stdin?, signal?, stream? }`. Pass
arguments in the command array or in `options.args`, not both; both throws `NeevError`.

```ts
const { stdout, stderr, exitCode } = await sandbox.exec(["python3", "main.py"], { cwd: "app" });

for await (const event of sandbox.exec(["sh", "-c", "for i in 1 2 3; do echo $i; sleep 1; done"], { stream: true })) {
  if (event.type === "stdout") process.stdout.write(event.data);
  else if (event.type === "stderr") process.stderr.write(event.data);
  else console.log("exit", event.exitCode);
}
```

`ExecResult` is `{ stdout: string; stderr: string; exitCode: number }`. `ExecStreamEvent`
is `{ type: "stdout"; data } | { type: "stderr"; data } | { type: "exit"; exitCode }`.

#### `sandbox.processes`

Runs detached processes that outlive the request that started them, each addressed by a
stable process id.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `start(command, options?)` | `Promise<Process>` | Starts a process; `options` = `{ args?, cwd?, env?, stdin?, signal? }`. |
| `get(id, options?)` | `Promise<ProcessStatus>` | Status; `{ wait: true }` blocks until the process exits. |
| `list(options?)` | `Promise<ProcessInfo[]>` | Running and recently exited processes. |
| `kill(id, signal?)` | `Promise<boolean>` | Signals one process (default SIGTERM); returns whether a signal was delivered. |
| `killAll(signal?)` | `Promise<number>` | Signals every running process; returns how many. |
| `logs(id, options?)` | `Promise<ProcessLogsPage>` | Reads captured output from `{ cursor? }`; returns `{ entries, cursor, dropped, state }`. |
| `follow(id, options?)` | `AsyncGenerator<ProcessLogEvent>` | Streams output until exit. |

The `Process` handle from `start` has `id`, `state`, `exitCode`, `startedAt`, and
`status()`, `wait()`, `kill(signal?)`, `logs(options?)` and `follow(options?)`.

```ts
import { Signal } from "@neevcloud/sdk";

const proc = await sandbox.processes.start("npm", { args: ["run", "dev"], cwd: "app" });
for await (const event of proc.follow()) {
  if (event.type === "stdout") process.stdout.write(event.data);
}
const final = await proc.wait(); // { state: "exited", exitCode, ... }
await sandbox.processes.killAll(Signal.TERM);
```

`ProcessState` is `"running" | "exited"`. `Signal` holds the accepted signal numbers:
`{ HUP, INT, QUIT, KILL, TERM }`.

### Files

`sandbox.files` works on the sandbox filesystem. Paths are relative to the workspace, or
absolute inside it; a path outside it is refused. Every method also takes `cwd` and
`signal` in its options.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `write(path, content, options?)` | `Promise<WriteFileResult>` | Writes a string or `Uint8Array`; returns `{ bytesWritten }`. Content over 1 MiB is sent with `upload`. |
| `upload(path, data, options?)` | `Promise<WriteFileResult>` | Uploads a string, `Uint8Array`, `ArrayBuffer` or `Blob` in resumable chunks; `options` = `{ chunkSize?, cwd?, onProgress?, signal? }` (`chunkSize` 64 KiB to 1 MiB, default 1 MiB). |
| `uploadFile(localPath, remotePath, options?)` | `Promise<WriteFileResult>` | Node only. Uploads a local file one chunk at a time. Same options as `upload`. |
| `downloadFile(remotePath, localPath, options?)` | `Promise<DownloadFileResult>` | Node only. Streams a sandbox file to disk; nothing is left at `localPath` if it fails. |
| `read(path, options?)` | `Promise<Uint8Array>` | Reads raw bytes; `{ offset?, length? }` reads a range. |
| `readText(path, options?)` | `Promise<string>` | Reads and decodes UTF-8; same options as `read`. |
| `list(path, options?)` | `Promise<FileEntry[]>` | Lists a directory; `{ recursive?, maxCount? }`. |
| `stat(path, options?)` | `Promise<FileEntry>` | Metadata for one entry. |
| `exists(path, options?)` | `Promise<boolean>` | Whether a path exists. |
| `mkdir(path, options?)` | `Promise<FileEntry>` | Creates a directory and any missing parents. |
| `move(source, destination, options?)` | `Promise<FileEntry>` | Moves or renames an entry. |
| `remove(path, options?)` | `Promise<void>` | Deletes a file, or a directory with `{ recursive: true }`. |
| `watch(path, options?)` | `AsyncGenerator<WatchEvent>` | Streams changes live; `{ recursive?, timeoutMs? }`. |

```ts
await sandbox.files.write("main.py", "print('hi')");
const bytes = await sandbox.files.read("main.py");
const head = await sandbox.files.read("big.log", { offset: 0, length: 4096 });
const entries = await sandbox.files.list(".", { recursive: true });
const there = await sandbox.files.exists("main.py");
await sandbox.files.mkdir("out/logs");
await sandbox.files.upload("data.bin", new Uint8Array(8 << 20), { onProgress: (sent, total) => console.log(sent, total) });

for await (const ev of sandbox.files.watch(".", { recursive: true })) {
  console.log(ev.type, ev.path);
}
```

`FileEntry` is `{ name; type: "file" | "directory" | "symlink"; path; size; mode; permissions; modifiedTime; symlinkTarget? }`.
`WatchEvent` is `{ type: "create" | "write" | "remove" | "rename" | "chmod"; path; entry? }`.

### Terminals and SSH

#### `sandbox.pty`

Opens an interactive terminal over a WebSocket. Output goes to the `onData` callback.

| Member | Returns | Summary |
| ------ | ------- | ------- |
| `create(options?)` | `Promise<PtyHandle>` | Opens a terminal, or reattaches with `{ id }`; `options` = `{ id?, program?, args?, cols?, rows?, onData? }`. Resolves once connected. |
| `handle.id` | `string \| undefined` | The terminal id, for reattaching later. |
| `handle.sendInput(data)` | `void` | Sends keystrokes (`string \| Uint8Array`). |
| `handle.resize(cols, rows)` | `void` | Forwards a window-size change. |
| `handle.kill(signal?)` | `void` | Signals the process group by name (default `"SIGTERM"`). |
| `handle.wait()` | `Promise<PtyResult>` | Resolves with `{ exitCode }` when the session ends. |
| `handle.disconnect()` | `void` | Closes the socket; the terminal keeps running, and `wait` resolves. |

```ts
const pty = await sandbox.pty.create({ cols: 80, rows: 24, onData: (b) => process.stdout.write(b) });
pty.sendInput("ls -la\n");
pty.resize(120, 40);
const { exitCode } = await pty.wait();

const again = await sandbox.pty.create({ id: pty.id, onData: (b) => process.stdout.write(b) });
```

The terminal needs a WebSocket that sends headers, which a runtime's global `WebSocket`
can't, so pass a factory on every runtime: in Node,
`new Neev({ webSocket: (url, opts) => new WebSocket(url, opts) })` built on the
[`ws`](https://www.npmjs.com/package/ws) package.

#### `sandbox.ssh`

Opens an SSH tunnel: a loopback listener that forwards each connection to the sandbox over
an authenticated WebSocket, so any ssh client, `scp`, `rsync` or IDE remote development
points at `{ host, port }` with no keys to manage.

| Member | Returns | Summary |
| ------ | ------- | ------- |
| `sandbox.ssh(options?)` | `Promise<SshTunnel>` | Binds the listener (`options` = `{ port?, host? }`; default a free port on `127.0.0.1`) and resolves once it is listening. |
| `tunnel.host` / `tunnel.port` | `string` / `number` | Where the listener is bound. |
| `tunnel.close()` | `Promise<void>` | Stops the listener and drops open connections. Safe to call twice. |

```ts
const tunnel = await sandbox.ssh();
console.log(`ssh -p ${tunnel.port} neev@localhost`);
await tunnel.close();
```

Node only. It uses the client's `webSocket` factory when set, and otherwise loads `ws`
itself; a missing `ws` throws at once.

### Code interpreter

Sandboxes created from `sb-ubuntu-26-04-interpreter` run Python in kernels that keep their
state between runs. Elsewhere, every `sandbox.code` call fails with reason
`interpreter_not_enabled`.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `run(code, options?)` | `Promise<Execution>` | Runs code in a context (the default one unless `options.context` is set). An exception in the code is returned in `error`, not thrown. |
| `createContext(options?)` | `Promise<CreatedCodeContext>` | Starts a separate kernel with its own state; `{ language?, cwd? }`. |
| `listContexts(options?)` | `Promise<CodeContext[]>` | Lists contexts with their `state`, `generation` and memory use (`rssMib`). |
| `restartContext(context, options?)` | `Promise<string>` | Restarts a context, dropping its state; returns the new `generation`. |
| `deleteContext(context, options?)` | `Promise<void>` | Stops a context; deleting `default` restarts it instead. |

`run` options: `context` or `language` (not both), `envs` (this run only), `timeoutMs`
(the cell's limit), `requestTimeoutMs` (a bound on the whole call), `signal`, and the
`onStdout`, `onStderr`, `onResult` and `onError` callbacks. An `Execution` has `stdout`,
`stderr`, `logs`, `results` (`CodeResult` values with `text`, `html`, `png` and more),
`text` (the last expression's value), `error`, `endReason`, `executionCount`,
`generation` and `truncated`; a changed `generation` means the context's state was lost.
A paused sandbox is woken, and the call keeps retrying for up to two minutes while it
wakes.

```ts
await sandbox.code.run("import pandas as pd\ndf = pd.DataFrame({'x': [1, 2, 3]})");
const run = await sandbox.code.run("int(df.x.sum())");
console.log(run.text, run.endReason); // "6" "ok"

const ctx = await sandbox.code.createContext({ cwd: "project" });
await sandbox.code.run("import os; print(os.getcwd())", { context: ctx });
```

### Low-level connection

Listed for completeness; prefer the handle methods above.

| API | Summary |
| --- | ------- |
| `neev.createSandboxConnection(connectUrl)` | Returns a `SandboxConnection` to one sandbox's runtime, with `exec`, `execStream`, and `files`, `processes`, `code` and `pty`. It doesn't wait for the sandbox to be Ready. |
| `SandboxFiles`, `SandboxProcesses`, `SandboxCode`, `SandboxPty` | The facades behind `sandbox.files`, `.processes`, `.code` and `.pty`. |
| `openSshTunnel(connection, options?)` | The function behind `sandbox.ssh()`. |

```ts
const conn = neev.createSandboxConnection(sandbox.connectUrl!);
const { stdout } = await conn.exec(["uname", "-a"]);
```

---

## Agents

An agent is a catalogue agent template, such as `"claude-code"`, running on its own
sandbox. Manage it through `neev.agents`; reach its files, `exec` and processes through
`agent.sandbox()`. Every method that takes an `id` accepts the agent's name too. Guide:
[Agents](./agents.md).

### `neev.agents`

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `create(params, scope?)` | `Promise<Agent>` | Creates an agent from a template (`name` and `agent_template` required). The handle may still be `Provisioning`; call `waitUntilReady`. |
| `list(params?)` | `Promise<AgentPage>` | Lists agents; `params` = `{ page?, limit?, orgId?, projectId? }`. |
| `get(id, scope?)` | `Promise<Agent>` | Fetches an agent by id or name. |
| `update(id, params, scope?)` | `Promise<Agent>` | Updates in place: `resources`, `egress`, `egress_add` / `egress_remove`, or `idle_timeout_seconds`. At least one is required. |
| `pause(id, scope?)` | `Promise<Agent>` | Pauses the agent's sandbox. |
| `resume(id, scope?)` | `Promise<Agent>` | Resumes a paused agent. |
| `keepalive(id, scope?)` | `Promise<Agent>` | Resets the idle timer. |
| `rollback(id, snapshotId, scope?)` | `Promise<Agent>` | Rolls the agent's sandbox back in place to a snapshot. |
| `createSnapshot(id, params?, scope?)` | `Promise<SnapshotData>` | Snapshots the agent's sandbox; starts `Pending`. |
| `listSnapshots(id, params?)` | `Promise<SnapshotPage>` | Lists the agent's snapshots; accepts `{ page, limit }`. |
| `fork(id, name, scope?)` | `Promise<Agent>` | Forks into a new agent with the same template and configuration, `Provisioning` until ready; the source keeps running. |
| `exposePort(id, port, params?)` | `Promise<SandboxPort>` | Exposes a port for a preview URL; `params` = `{ slug?, orgId?, projectId? }`. |
| `listPorts(id, scope?)` | `Promise<SandboxPort[]>` | Lists the exposed preview ports. |
| `revokePort(id, port, scope?)` | `Promise<void>` | Stops serving a preview port. |
| `getPortUrl(id, port, options?, scope?)` | `Promise<string>` | Exposes a port and returns its preview URL once routable; same options as `neev.sandboxes.getPortUrl`. |
| `audit(id, params?)` | `Promise<AuditTrail>` | One page of the audit trail. See [Audit trail](#audit-trail). |
| `delete(id, scope?)` | `Promise<void>` | Permanently deletes the agent and its sandbox. |

**`create(params, scope?)`**

| Field | Notes |
| --- | --- |
| `name`, `agent_template` | Required |
| `config` | Overrides the template's default configuration |
| `resources`, `env`, `region` | As on `neev.sandboxes.create` |
| `egress`, `allowInternet`, `allowEgress` | Replace the template's egress allow-list. Omit them to keep it, and add hosts later with `egress_add` |
| `idle_timeout_seconds` | Omit for the account default; `0` means no idle limit (the agent then holds quota until it is deleted) |

**`update(id, params, scope?)`** takes the same `resources`, `egress`, `egress_add` and
`egress_remove` rules as `neev.sandboxes.update`, plus `idle_timeout_seconds` (`0` removes
the idle limit). An empty update, or `egress_add` / `egress_remove` combined with
`egress`, throws `NeevError` before any request is sent.

```ts
const agent = await neev.agents.create({ name: "reviewer", agent_template: "claude-code", idle_timeout_seconds: 900 });
await agent.waitUntilReady();

await neev.agents.update(agent.id, { egress_add: { allow: [{ host: "api.example.com", ports: [443] }] } });
await neev.agents.keepalive(agent.id);
const snap = await neev.agents.createSnapshot(agent.id, { name: "before" });
const page = await neev.agents.listSnapshots(agent.id);
const copy = await neev.agents.fork(agent.id, "reviewer-copy");
const trail = await neev.agents.audit(agent.id, { limit: 50 });
```

The agent audit trail has the same events, filters and recording rules as the
[sandbox one](#audit-trail). An agent has no `execution_trace` setting.

### Agent templates

Read-only catalogue of agent templates. A template's `name` is what you pass as
`agent_template`.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `neev.agentTemplates.list(params?)` | `Promise<AgentTemplatePage>` | Lists active agent templates; `params` = `{ page?, limit? }`. |
| `neev.agentTemplates.get(id)` | `Promise<AgentTemplate>` | Fetches one agent template by id. |

```ts
const { items } = await neev.agentTemplates.list();
```

### `Agent` handle

Returned by `neev.agents.create`, `get`, `fork` and `list().items`.

| Member | Returns | Summary |
| ------ | ------- | ------- |
| `id` / `name` | `string` | Agent UUID and name. |
| `status` | `AgentStatus` | `"Provisioning" \| "Ready" \| "Pausing" \| "Paused" \| "Failed" \| "Deleting"`, as last seen. |
| `templateId` / `sandboxId` | `string` | The template it was created from; the id of its sandbox. |
| `config` | `Record<string, unknown> \| undefined` | Effective template configuration. |
| `idleTimeoutSeconds` | `number \| null` | Idle window in seconds; `0` is no idle limit, `null` the account default. |
| `lastCrash` | `AgentLastCrash \| null` | Most recent unexpected stop; same meaning as `sandbox.lastCrash`. |
| `data` / `toJSON()` | `AgentData` | The raw API record. |
| `waitUntilReady(options?)` | `Promise<this>` | Polls until `"Ready"`; throws at once on `"Failed"` or `"Paused"`, or on timeout. `options` = `{ timeoutMs?, pollIntervalMs? }`. |
| `refresh()` | `Promise<this>` | Re-fetches and updates the handle. |
| `update(params)` / `pause()` / `resume()` / `keepalive()` | `Promise<this>` | Lifecycle actions; each updates the handle. |
| `rollback(snapshotId)` | `Promise<this>` | Rolls the agent's sandbox back to a snapshot. |
| `snapshot(options?)` | `Promise<SnapshotData>` | As `sandbox.snapshot()`, including `waitUntilReady`. |
| `snapshots(params?)` | `Promise<SnapshotPage>` | Lists the agent's snapshots. |
| `fork(name)` | `Promise<Agent>` | Returns the new agent's handle; this handle is unchanged. |
| `getUrl(options)` | `Promise<string>` | Exposes `options.port` and returns its preview URL once routable. |
| `exposePort(port, options?)` / `listPorts()` / `revokePort(port)` | | Preview ports, as on the sandbox handle. |
| `audit(params?)` | `Promise<AuditTrail>` | One page of the audit trail. |
| `sandbox()` | `Promise<Sandbox>` | The agent's sandbox as a `Sandbox` handle, for `files`, `exec` and `processes`. |
| `delete()` | `Promise<void>` | Permanently deletes the agent. |

```ts
const agent = await neev.agents.get("reviewer");
const url = await agent.getUrl({ port: 3000 });
const snap = await agent.snapshot({ waitUntilReady: true });
const fork = await agent.fork("reviewer-fork");
await fork.waitUntilReady();
const sandbox = await agent.sandbox();
await sandbox.files.write("notes.md", "# hello\n");
```

---

## Agent tools

Guide: [Agent tools](./agent-tools.md). Full symbol list:
[API inventory](./api-inventory.md#agent-tools).

### The tool contract

`@neevcloud/sdk/agent-tools` exports `SandboxTools`, the tool metadata (`DESCRIPTIONS`,
`PARAMETERS` as JSON Schema, `TITLES` for display), and `FatalGuard`.

| Member | Returns | Summary |
| ------ | ------- | ------- |
| `new SandboxTools(sandbox, options?)` | | Binds the tools to a sandbox; `options` = `{ allowPreview?, allowRollback?, allowProcesses? }`, all off by default. |
| `tools.names()` | `ToolName[]` | The enabled tools, in contract order. |
| `tools.specs()` | `ToolSpec[]` | One `{ name, title, description, parameters, call(args) }` per enabled tool. |
| `tools.call(name, args)` | `Promise<ToolResult>` | Runs a tool call from the model. An unknown or disabled tool, or bad arguments, resolve to `{ error }`. |
| `new FatalGuard()` | | One per run. `guard.call(spec, args)` answers a throw with `{ error: FATAL_ERROR }`, aborts `guard.signal` and refuses later calls; `guard.failed`, `guard.error` and `guard.raiseIfFailed()` report it. |

| Tool | Method | Opt-in |
| ---- | ------ | ------ |
| `run_command` | `runCommand({ command, cwd?, timeout_s? })` | |
| `write_file` | `writeFile({ path, content })` | |
| `read_file` | `readFile({ path, offset?, length? })` | |
| `stat_path` | `statPath({ path })` | |
| `move_path` | `movePath({ source, destination })` | |
| `delete_path` | `deletePath({ path, recursive? })` | |
| `expose_port` | `exposePort({ port })` | `allowPreview` |
| `checkpoint` / `rollback` | `checkpoint({ label? })` / `rollback({ checkpoint_id })` | `allowRollback` |
| `start_process` / `read_process_output` / `stop_process` / `list_processes` | `startProcess({ command, cwd? })` / `readProcessOutput({ process_id, cursor?, wait_s? })` / `stopProcess({ process_id })` / `listProcesses()` | `allowProcesses` |

```ts
import { DESCRIPTIONS, PARAMETERS, SandboxTools } from "@neevcloud/sdk/agent-tools";

const tools = new SandboxTools(sandbox, { allowProcesses: true });
const specs = tools.names().map((name) => ({ name, description: DESCRIPTIONS[name], parameters: PARAMETERS[name] }));
const result = await tools.call("run_command", { command: "npm test", timeout_s: 120 });
```

### Framework adapters

| Subpath | Export | Framework (optional peer) |
| ------- | ------ | ------------------------- |
| `@neevcloud/sdk/agent-tools/claude` | `toClaude(tools)` returns `{ options(), watch(query), guard }` | `@anthropic-ai/claude-agent-sdk` ^0.3.142, `zod` 4.2 or later |
| `@neevcloud/sdk/agent-tools/openai-agents` | `toOpenAIAgents(tools)` returns `FunctionTool[]` | `@openai/agents` ^0.20.0 (Node 20+) |
| `@neevcloud/sdk/agent-tools/ai-sdk` | `toAiSdk(tools)` returns `{ tools, guard }` | `ai` 5, 6 or 7 |

- `toClaude`: spread `options()` into `query()`'s options; the tools run in-process as an
  MCP server with Claude Code's own tools switched off. `watch(query)` yields the messages,
  stops and throws if a sandbox call fails, and always closes the query.
- `toOpenAIAgents`: a sandbox call that throws ends `run`.
- `toAiSdk`: pass `abortSignal: guard.signal`, and call `guard.raiseIfFailed()` after the
  run, also when it throws.

```ts
import { generateText, stepCountIs } from "ai";
import { SandboxTools } from "@neevcloud/sdk/agent-tools";
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

Every failure is a `NeevError` subclass. Guide: [Errors](./errors.md).

| Class | Status | Meaning |
| ----- | ------ | ------- |
| `NeevError` | | Base class for every SDK error. |
| `APIConnectionError` | | No HTTP response (DNS, reset, abort). |
| `APITimeoutError` | | The request ran past the configured timeout. |
| `APIError` | non-2xx | Base for HTTP errors; carries `status`, `code`, `reason`, `scope`, `details` and `requestId`. |
| `BadRequestError` | 400 | Malformed or invalid request. |
| `AuthenticationError` | 401 | Missing, invalid or expired API key. |
| `PermissionDeniedError` | 403 | Not allowed on this organization, project or resource. |
| `NotFoundError` | 404 | The resource does not exist. |
| `ConflictError` | 409 | Conflicts with the current state. |
| `PreconditionFailedError` | 412 | A precondition failed. |
| `TooEarlyError` | 425 | Not ready yet, such as an agent still provisioning; retry later. |
| `RateLimitError` | 429 | Rate limit exceeded, or a paused sandbox that didn't wake. |
| `InternalServerError` | Other 5xx | The server failed to handle a valid request. |
| `ServiceUnavailableError` | 503 | Temporarily unavailable; retry shortly. A subclass of `InternalServerError`. |
| `DeadlineExceededError` | 504 | The operation ran past the server's deadline. |

`ErrorCode` is the union of codes the API sends in `code`.

```ts
import { APIError, NotFoundError } from "@neevcloud/sdk";

try {
  await neev.sandboxes.get("missing");
} catch (err) {
  if (err instanceof NotFoundError) {
    // handle a missing sandbox
  } else if (err instanceof APIError) {
    console.error(err.status, err.code, err.requestId);
  }
}
```
