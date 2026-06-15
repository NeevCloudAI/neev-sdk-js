# @neevcloud/sdk — API Reference

Task-oriented API lists and copy-paste snippets for the public `@neevcloud/sdk` package. Every lifecycle method is async — `await` it. For install, env vars, and first scripts, see [`getting-started.md`](./getting-started.md). For the exhaustive symbol inventory (every exported type, field tables, and the error hierarchy), see [`api-inventory.md`](./api-inventory.md).

## Table of contents

- [Client](#client)
- [Lifecycle](#lifecycle)
- [Snapshots](#snapshots)
- [Sandbox handle](#sandbox-handle)
- [Runtime](#runtime)
- [Errors](#errors)
- [Inline example snippets](#inline-example-snippets)
- [Maintaining this reference](#maintaining-this-reference)

---

## Client

Construct one `Neev` instance and reuse it; the resource namespaces (`sandboxes`, `templates`, `raw`) hang off the instance. Every config field is optional and falls back to a `NEEV_*` environment variable.

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

Creates the platform client. Auth is a Bearer API key; the sandboxd runtime reuses this key (the gateway derives the sandbox id from the `connect_url` host).

| Option | Env var | Default | Notes |
| ------ | ------- | ------- | ----- |
| `apiKey` | `NEEV_API_KEY` | — | Required. Throws if unset. |
| `orgId` | `NEEV_ORG_ID` | — | Required at call time; overridable per call via `Scope`. |
| `projectId` | `NEEV_PROJECT_ID` | — | Required at call time; overridable per call via `Scope`. |
| `baseURL` | `NEEV_BASE_URL` | `https://api.ai.neevcloud.com/agent` | Set only to target another environment. |
| `timeoutMs` | — | `60000` | Per-request timeout. |
| `maxRetries` | — | `2` | Retries on network errors, `429`, and `5xx` (lifecycle only). |
| `fetch` | — | global `fetch` | Custom fetch implementation. |

There is no `close()` — the client holds no persistent connections. Most methods accept an optional trailing `Scope` (`{ orgId?, projectId? }`) to target a different org/project than the client default.

---

## Lifecycle

Lifecycle APIs manage sandboxes and templates via the platform gateway.

### `neev.sandboxes`

Every method returns a `Sandbox` handle (or a page of handles) so callers can chain lifecycle actions on the result.

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `create(params, scope?)` | `Promise<Sandbox>` | Creates a sandbox in the resolved org/project. The handle may still be `Pending` — call `waitUntilReady`. |
| `list(params?)` | `Promise<SandboxPage>` | Lists sandboxes with pagination; items are wrapped handles. |
| `get(id, scope?)` | `Promise<Sandbox>` | Fetches the current record for a sandbox by id. |
| `pause(id, scope?)` | `Promise<Sandbox>` | Pauses a sandbox (scales to zero replicas). |
| `resume(id, scope?)` | `Promise<Sandbox>` | Resumes a paused sandbox (scales to one replica). |
| `delete(id, scope?)` | `Promise<void>` | Permanently deletes a sandbox (CR + DB row). |
| `metrics(id, params?)` | `Promise<SandboxMetricsResponse>` | Reads the live, tenant-scoped metric series over an optional time window. |
| `createSnapshot(id, params?, scope?)` | `Promise<SnapshotData>` | Captures a filesystem snapshot; returns immediately with `status: "Pending"`. |
| `listSnapshots(id, params?)` | `Promise<SnapshotPage>` | Lists a sandbox's snapshots. **Paginated** — accepts `{ page, limit }`, returns `{ items, total, page, limit }`. |
| `getSnapshot(snapshotId, scope?)` | `Promise<SnapshotData>` | Fetches snapshot metadata by project-scoped id. |
| `deleteSnapshot(snapshotId, scope?)` | `Promise<void>` | Deletes a snapshot and its stored blob. |
| `restore(id, snapshotId, scope?)` | `Promise<Sandbox>` | Restores a sandbox **in place** from one of its snapshots. |
| `fork(id, name, scope?)` | `Promise<Sandbox>` | Forks a sandbox into a new named sandbox from its **current live state**. |

**`create(params, scope?)`** — only `name` is required; `sandbox_template_id` and `region` are optional and server-defaulted.

```ts
const sandbox = await neev.sandboxes.create({ name: "my-agent" });
await sandbox.waitUntilReady();
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

**`metrics(id, params?)`** — `params` is `{ from?, to?, step?, orgId?, projectId? }`; `from`/`to` are RFC3339, `step` is a Go duration (e.g. `"60s"`). The server defaults to the last hour.

```ts
const metrics = await neev.sandboxes.metrics(id, { step: "60s" });
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

Snapshots capture a sandbox's filesystem state. They are **asynchronous**: `createSnapshot` / `sandbox.snapshot` return `status: "Pending"`; poll `getSnapshot` (or read `snapshot.status`) until `"Ready"` before restoring or forking from it. Status values are `"Pending" | "Running" | "Ready" | "Failed"`.

Two distinct paths:

- **`restore(id, snapshotId)`** — rolls the **same** sandbox in place back to a **chosen** snapshot.
- **`fork(id, name)`** — atomically snapshots the source's **current live state** into a **brand-new** sandbox; it does **not** reuse an existing snapshot, and the source keeps running.

```ts
const sandbox = await neev.sandboxes.get(id);

// Capture filesystem state (starts Pending).
const pending = await sandbox.snapshot({ name: "checkpoint" });

// Poll until Ready.
let snap = await neev.sandboxes.getSnapshot(pending.id);
while (snap.status === "Pending" || snap.status === "Running") {
  await new Promise((r) => setTimeout(r, 2000));
  snap = await neev.sandboxes.getSnapshot(pending.id);
}

await sandbox.restore(snap.id);             // restore this sandbox in place
const fork = await sandbox.fork("my-fork"); // branch current live state into a new sandbox

const { items } = await neev.sandboxes.listSnapshots(id); // paginated: { page, limit }
await neev.sandboxes.deleteSnapshot(snap.id);
```

`listSnapshots` / `sandbox.snapshots()` return a `SnapshotPage` (`{ items: SnapshotData[]; total; page; limit }`) and accept `{ page, limit }`.

---

## Sandbox handle

`Sandbox` instances are returned by `create()`, `get()`, and `list().items`. They carry the last-known server state and expose lifecycle and runtime actions that operate on this sandbox in place. Construct via the `sandboxes` resource, never directly.

### Getters

| Getter | Type | Summary |
| ------ | ---- | ------- |
| `id` | `string` | Sandbox UUID. |
| `name` | `string` | Human-readable name. |
| `phase` | `SandboxPhase` | Lifecycle phase as last seen (e.g. `"Pending"`, `"Ready"`, `"Paused"`). |
| `replicas` | `number` | Desired replica count (0 paused, 1 running). |
| `region` | `string` | Region slug the sandbox runs in. |
| `templateId` | `string \| null` | Template id it was created from, or `null`. |
| `resources` | `SandboxResources \| undefined` | Provisioned compute size, or `undefined` when defaulted. |
| `connectUrl` | `string \| null` | Daemon address, or `null` when not yet configured. |
| `data` | `SandboxData` | Full raw API record. |

### Methods

| Method | Returns | Summary |
| ------ | ------- | ------- |
| `waitUntilReady(options?)` | `Promise<this>` | Polls until phase is `"Ready"`. Throws fast if `"Paused"`, or on timeout. |
| `refresh()` | `Promise<this>` | Re-fetches the record and updates the handle in place. |
| `pause()` | `Promise<this>` | Pauses (scales to zero) and updates the handle. |
| `resume()` | `Promise<this>` | Resumes (scales to one) and updates the handle. |
| `delete()` | `Promise<void>` | Permanently deletes the sandbox. |
| `metrics(params?)` | `Promise<SandboxMetricsResponse>` | Reads the live metric series; `params` is `{ from?, to?, step? }`. |
| `snapshot(params?)` | `Promise<SnapshotData>` | Captures this sandbox's state (starts `Pending`). |
| `snapshots(params?)` | `Promise<SnapshotPage>` | Lists this sandbox's snapshots (paginated: `{ page, limit }`). |
| `restore(snapshotId)` | `Promise<this>` | Restores this sandbox in place from a chosen snapshot. |
| `fork(name)` | `Promise<Sandbox>` | Forks the current live state into a new sandbox handle. |
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

Runtime APIs run commands and access files **inside** a sandbox, reached directly at the sandbox's `connect_url`. Use `sandbox.exec` / `sandbox.files` on the handle — it resolves and caches the connection automatically, waiting until the sandbox is `Ready` on first use. These calls are **never retried** (a retried `write`/`exec` could run twice). File paths are workspace-relative (the daemon rejects absolute paths).

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
| `write(path, content, options?)` | `Promise<WriteFileResult>` | Writes string or `Uint8Array`; returns `{ bytesWritten }`. |
| `read(path, options?)` | `Promise<Uint8Array>` | Reads a file as raw bytes (binary-safe). |
| `readText(path, options?)` | `Promise<string>` | Reads a file and decodes it as UTF-8. |
| `list(path, options?)` | `Promise<FileEntry[]>` | Lists directory entries; `options` = `{ cwd?, recursive?, maxCount?, signal? }`. |

```ts
await sandbox.files.write("main.py", "print('hi')"); // → { bytesWritten }
const bytes = await sandbox.files.read("main.py");    // → Uint8Array
const text = await sandbox.files.readText("main.py"); // → string
const entries = await sandbox.files.list(".", { recursive: true }); // → FileEntry[]
```

`FileEntry`: `{ name; type: "file" | "directory" | "symlink"; path; size; mode; permissions; modifiedTime; symlinkTarget? }`.

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

### Low-level connection types

Listed for completeness; prefer the handle methods above.

| Type | Summary |
| ---- | ------- |
| `SandboxConnection` | A live connection to one sandbox's daemon. Construct via `neev.createSandboxConnection(connectUrl)`, or reach it through `sandbox.exec` / `sandbox.files` / `sandbox.processes`. Exposes `exec`, `execStream`, and `files` / `processes` facades. |
| `SandboxFiles` | The filesystem facade (`write`/`read`/`readText`/`list`). Accessed via `sandbox.files` or `connection.files`. |
| `SandboxProcesses` | The process-supervisor facade (`start`/`get`/`list`/`kill`/`killAll`/`logs`/`follow`). Accessed via `sandbox.processes` or `connection.processes`. |

---

## Errors

Every failure is a `NeevError` subclass — branch on `instanceof` rather than parsing strings. `APIError` carries `status`, `code`, `details`, and `requestId`.

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
| `APIError` | non-2xx | Base for HTTP responses; carries `status`/`code`/`details`/`requestId`. |
| `BadRequestError` | 400 | Malformed or invalid request. |
| `AuthenticationError` | 401 | Missing, invalid, or expired API key. |
| `PermissionDeniedError` | 403 | Not allowed on this org/project/resource. |
| `NotFoundError` | 404 | Resource does not exist. |
| `ConflictError` | 409 | Conflicts with current state. |
| `PreconditionFailedError` | 412 | A precondition failed. |
| `RateLimitError` | 429 | Rate limit exceeded. |
| `DeadlineExceededError` | 504 | Operation exceeded the server deadline. |
| `InternalServerError` | 5xx | Server failed to handle a valid request. |

---

## Inline example snippets

Minimal one-liners for each public API.

### Lifecycle

| API | Snippet |
| --- | ------- |
| `new Neev(...)` | `const neev = new Neev({ apiKey, orgId, projectId });` |
| `neev.sandboxes.create(...)` | `const sandbox = await neev.sandboxes.create({ name: "my-agent" });` |
| `neev.sandboxes.list(...)` | `const { items } = await neev.sandboxes.list({ limit: 50 });` |
| `neev.sandboxes.get(id)` | `const sandbox = await neev.sandboxes.get(id);` |
| `neev.sandboxes.pause(id)` | `await neev.sandboxes.pause(id);` |
| `neev.sandboxes.resume(id)` | `await neev.sandboxes.resume(id);` |
| `neev.sandboxes.delete(id)` | `await neev.sandboxes.delete(id);` |
| `neev.sandboxes.metrics(id, ...)` | `const m = await neev.sandboxes.metrics(id, { step: "60s" });` |
| `neev.sandboxes.createSnapshot(id, ...)` | `const snap = await neev.sandboxes.createSnapshot(id, { name: "checkpoint" });` |
| `neev.sandboxes.listSnapshots(id, ...)` | `const { items } = await neev.sandboxes.listSnapshots(id, { page: 1, limit: 20 });` |
| `neev.sandboxes.getSnapshot(snapshotId)` | `const snap = await neev.sandboxes.getSnapshot(snapshotId);` |
| `neev.sandboxes.deleteSnapshot(snapshotId)` | `await neev.sandboxes.deleteSnapshot(snapshotId);` |
| `neev.sandboxes.restore(id, snapshotId)` | `await neev.sandboxes.restore(id, snapshotId);` |
| `neev.sandboxes.fork(id, name)` | `const fork = await neev.sandboxes.fork(id, "my-fork");` |
| `neev.templates.list(...)` | `const { items } = await neev.templates.list({ limit: 10 });` |
| `neev.templates.get(id)` | `const tpl = await neev.templates.get("sb-ubuntu-26-04-minimal");` |
| `neev.raw.request(...)` | `const data = await neev.raw.request<T>({ method: "GET", path });` |
| `sandbox.id` / `.name` / `.phase` | `console.log(sandbox.phase, sandbox.replicas);` |
| `sandbox.connectUrl` | `console.log(sandbox.connectUrl);` |
| `sandbox.data` | `const record = sandbox.data;` |
| `sandbox.refresh()` | `await sandbox.refresh();` |
| `sandbox.waitUntilReady(...)` | `await sandbox.waitUntilReady({ timeoutMs: 120_000 });` |
| `sandbox.pause()` / `sandbox.resume()` | `await sandbox.pause();  await sandbox.resume();` |
| `sandbox.snapshot(...)` | `const pending = await sandbox.snapshot({ name: "demo-snap" });` |
| `sandbox.snapshots(...)` | `const { items } = await sandbox.snapshots({ page: 1, limit: 20 });` |
| `sandbox.restore(snapshotId)` | `await sandbox.restore(snapshotId);` |
| `sandbox.fork(name)` | `const fork = await sandbox.fork("my-fork");` |
| `sandbox.delete()` | `await sandbox.delete();` |
| `sandbox.metrics(...)` | `const m = await sandbox.metrics({ step: "60s" });` |
| `sandbox.toJSON()` | `JSON.stringify(sandbox);` |

### Runtime

| API | Snippet |
| --- | ------- |
| `sandbox.exec(...)` (buffered) | `const r = await sandbox.exec(["echo", "hi"]);` |
| `sandbox.exec(..., { stream: true })` | `for await (const e of sandbox.exec(cmd, { stream: true })) { /* … */ }` |
| `sandbox.execStream(...)` (deprecated) | `for await (const e of sandbox.execStream(cmd)) { /* … */ }` |
| `sandbox.files.write(...)` | `await sandbox.files.write("main.py", "print('hi')");` |
| `sandbox.files.read(...)` | `const bytes = await sandbox.files.read("main.py");` |
| `sandbox.files.readText(...)` | `const text = await sandbox.files.readText("main.py");` |
| `sandbox.files.list(...)` | `const entries = await sandbox.files.list(".", { recursive: true });` |
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
