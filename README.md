# @neevcloud/sdk

> Official NeevCloud SDK for the Neev platform — Node, Bun, Deno & edge.

`@neevcloud/sdk` is the single, growing TypeScript client for the **Neev platform**.
One package, one auth model, one client — adopt new capabilities as they ship.

**Available today**

- **`neev.sandboxes`** — full agent-sandbox lifecycle: create, list, get, pause, resume, delete, live metrics, plus snapshots, restore, and fork. Inside a running sandbox: `files`, `exec`, and a `processes` supervisor for long-running, detached processes. Sandboxes are gVisor-isolated (`runsc`) compute environments for AI agents.
- **`neev.templates`** — the platform sandbox-template catalogue (list, get). A template id (e.g. `sb-ubuntu-26-04-minimal`) is optional when creating a sandbox; omit it to use the platform's default template.

**Coming next**

- `neev.inference`, `neev.runtimes`, `neev.storage`, … — rolling out in the same package.

---

## Install

```sh
npm install @neevcloud/sdk
# or: pnpm add @neevcloud/sdk · yarn add @neevcloud/sdk · bun add @neevcloud/sdk
```

Requires a server-side JS runtime with global `fetch`: **Node 18+**, **Bun**, **Deno**, or an edge runtime. There is no browser build — your API key must never ship to a browser.

## Authentication

The client reads configuration from explicit options or `NEEV_*` environment variables:

| Option      | Env var                 | Required | Default |
| ----------- | ----------------------- | -------- | ------- |
| `apiKey`    | `NEEV_API_KEY`          | yes      | —       |
| `orgId`     | `NEEV_ORG_ID`           | yes\*    | —       |
| `projectId` | `NEEV_PROJECT_ID`       | yes\*    | —       |
| `baseURL`   | `NEEV_BASE_URL`         | no       | production API |

\* `orgId` / `projectId` may be set on the client or overridden per call.

`baseURL` defaults to the Neev production API; set `NEEV_BASE_URL` only to target another environment.

## Quickstart

```ts
import { Neev } from "@neevcloud/sdk";

const neev = new Neev({
  apiKey: process.env.NEEV_API_KEY,
  orgId: process.env.NEEV_ORG_ID,
  projectId: process.env.NEEV_PROJECT_ID,
});

// Create a sandbox from a template and wait for it to come up.
const sandbox = await neev.sandboxes.create({
  name: "my-agent",
  sandbox_template_id: "sb-ubuntu-26-04-minimal",
  region: "as-south-1", // production region
});
await sandbox.waitUntilReady();

console.log(sandbox.id, sandbox.phase, sandbox.connectUrl);

// Pause it when idle, resume on demand, delete when done.
await sandbox.pause();
await sandbox.resume();
await sandbox.delete();
```

To run the examples from a clone (including against dev), see [`examples/README.md`](./examples/README.md) for the full setup and per-example commands.

## Usage

### Resource methods

```ts
const page = await neev.sandboxes.list({ limit: 50 });
const sandbox = await neev.sandboxes.get(id);
await neev.sandboxes.pause(id);
await neev.sandboxes.resume(id);
await neev.sandboxes.delete(id);
const metrics = await neev.sandboxes.metrics(id, { step: "60s" });

// Snapshots, restore, and fork (see "Snapshots, fork & restore" below).
const snap = await neev.sandboxes.createSnapshot(id, { name: "checkpoint" });
const { items } = await neev.sandboxes.listSnapshots(id); // paginated
// `snap` starts Pending — wait until it reaches Ready before restoring from it
// (see "Snapshots, fork & restore" below for the poll loop).
await neev.sandboxes.restore(id, snap.id);             // restore in place once snap is Ready
const fork = await neev.sandboxes.fork(id, "my-fork"); // fork the current live state (no snapshot needed)
```

### Sandbox templates

`sandbox_template_id` is optional — omit it to use the platform's default template, or pass a known id directly, or browse the catalogue to discover one:

```ts
// Create directly from a known template id.
const sandbox = await neev.sandboxes.create({
  name: "my-agent",
  sandbox_template_id: "sb-ubuntu-26-04-minimal",
  region: "as-south-1", // production region
});

// Or discover what's available first.
const { items } = await neev.templates.list();
const template = await neev.templates.get("sb-ubuntu-26-04-minimal"); // inspect one
```

### Sandbox handles

`create`, `get`, and `list` return `Sandbox` handles with lifecycle methods on the object itself:

```ts
const sandbox = await neev.sandboxes.get(id);
await sandbox.refresh();          // re-fetch latest state
await sandbox.waitUntilReady();   // poll until phase === "Ready"
await sandbox.pause();
const snap = await sandbox.snapshot();      // capture this sandbox's state (starts Pending)
const fork = await sandbox.fork("my-fork"); // branch the current state into a new sandbox
// restore needs `snap` Ready first — poll getSnapshot (see "Snapshots, fork & restore" below).
await sandbox.restore(snap.id);             // restore this sandbox in place once snap is Ready
sandbox.data;                     // full raw API record
```

### Per-call scope override

Methods accept an optional scope to target a different org/project than the client default:

```ts
await neev.sandboxes.list({ orgId: "other-org", projectId: "other-proj" });
```

### Error handling

Every failure is a typed `NeevError` subclass:

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

Transient failures (network errors, `429`, `5xx`) are retried automatically with exponential backoff (configurable via `maxRetries`).

### Advanced: untyped requests

Most resources are typed against an OpenAPI spec. For endpoints that don't have a published spec yet, `neev.raw` issues requests over the same transport (auth, retries, timeout, typed errors), with caller-supplied types:

```ts
const widget = await neev.raw.request<{ id: string }>({
  method: "GET",
  path: "/api/v1beta1/orgs/acme/projects/web/widgets/123",
});
```

These graduate to fully-typed resource methods as specs land in the SDK.

### Working inside a sandbox (files & exec)

Operations that act inside a running sandbox are reached directly on the sandbox handle. The handle resolves the sandbox's `connect_url` (returned by `create`/`get`/`list`) on first use and caches it; if the sandbox isn't Ready yet, the first `files`/`exec` call waits until it is:

File paths are workspace-relative (the daemon rejects absolute paths):

```ts
const sandbox = await neev.sandboxes.get(id);
await sandbox.files.write("main.py", "print('hi')"); // → { bytesWritten }
const bytes = await sandbox.files.read("main.py"); // → Uint8Array
const text = await sandbox.files.readText("main.py"); // → string
const entries = await sandbox.files.list(".", { recursive: true }); // → FileEntry[]

const result = await sandbox.exec(["sh", "-c", "python3 main.py"]); // → { stdout, stderr, exitCode }
```

By default `exec` is buffered — it runs the command to completion and returns captured output; a non-zero `exitCode` is returned, not thrown.

To consume output **as it is produced** (long-running commands, live logs), pass `{ stream: true }`. The same `exec` then returns an async iterable that yields `stdout`/`stderr` text chunks the moment the daemon flushes them, then a terminal `exit` event:

```ts
for await (const event of sandbox.exec(["sh", "-c", "for i in 1 2 3; do echo $i; sleep 1; done"], {
  stream: true,
})) {
  if (event.type === "stdout") process.stdout.write(event.data);
  else if (event.type === "stderr") process.stderr.write(event.data);
  else console.log("exit", event.exitCode); // non-zero is reported here, not thrown
}
```

These calls are **not** retried automatically (a retried `write` could run twice) — handle retries yourself if needed.

### Long-running processes

`exec` ties a command's lifetime to your request. For background work that should outlive a single call — a dev server, a build, a watcher — use `sandbox.processes`. The supervisor runs the process detached, addressed by a stable `process_id`, so you can start it, follow or poll its output, await its exit, and signal it across separate calls:

```ts
const proc = await sandbox.processes.start("npm", { args: ["run", "dev"], cwd: "app" });
proc.id; // "proc_9f3a…"

// Follow combined stdout/stderr live until the process exits (or you abort).
for await (const event of proc.follow()) {
  if (event.type === "stdout") process.stdout.write(event.data);
  else if (event.type === "stderr") process.stderr.write(event.data);
  else console.log("exit", event.exitCode);
}

// …or poll with a reconnect-safe cursor instead of following.
const page = await proc.logs({ cursor: 0 }); // → { entries, cursor, dropped, state }

const status = await proc.status();          // non-blocking snapshot
const final = await proc.wait();             // block until it exits → { state, exitCode, … }
await proc.kill(Signal.TERM);                // signal; default is SIGTERM
```

Collection-level operations live on `sandbox.processes`:

```ts
const all = await sandbox.processes.list();        // → ProcessInfo[]
const status = await sandbox.processes.get(id);    // by process_id
const signalled = await sandbox.processes.kill(id, Signal.KILL);
const count = await sandbox.processes.killAll();   // signal every running process
```

Output is captured in a bounded ring: `logs` returns plain-text `entries` plus a monotonic `cursor` to resume from, and `dropped: true` when the ring rolled past your cursor. `follow` is the streaming counterpart; a client abort ends it without an `exit` event. Like `files`/`exec`, the first process call waits until the sandbox is Ready to resolve its `connect_url`.

The full example is [`examples/processes.ts`](./examples/processes.ts).

### Snapshots, fork & restore

Capture a sandbox's state as a **snapshot**, then **restore** the same sandbox back to that snapshot. A snapshot is created `Pending` and must reach `Ready` before it can be restored — poll `getSnapshot` (or read `snapshot.status`). **Fork** is separate: it atomically snapshots a sandbox's *current* live state into a brand-new sandbox (it does not reuse an existing snapshot), and the source keeps running:

```ts
const sandbox = await neev.sandboxes.get(id);

// Capture the sandbox's filesystem state.
const pending = await sandbox.snapshot({ name: "checkpoint" });
let snap = await neev.sandboxes.getSnapshot(pending.id);
while (snap.status === "Pending" || snap.status === "Running") {
  await new Promise((r) => setTimeout(r, 2000));
  snap = await neev.sandboxes.getSnapshot(pending.id);
}

// Restore the original in place from the snapshot; fork branches the current
// live state into a brand-new sandbox (it does not consume `snap`).
await sandbox.restore(snap.id);             // → this sandbox, restored
const fork = await sandbox.fork("my-fork"); // → a new Sandbox handle

const { items } = await neev.sandboxes.listSnapshots(id); // paginated; pass { page, limit }
await neev.sandboxes.deleteSnapshot(snap.id);
```

The full snapshot example is [`examples/snapshot-fork-restore.ts`](./examples/snapshot-fork-restore.ts).

## Documentation

SDK guides and reference live in [`docs/`](./docs):

- [Getting started](./docs/getting-started.md) — install, credentials, first sandbox
- [API reference](./docs/api-reference.md) — grouped API lists + snippets
- [API inventory](./docs/api-inventory.md) — exhaustive signatures, types, errors

Full platform documentation: <https://docs.neevcloud.com>.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: [SECURITY.md](./SECURITY.md).

## License

[Apache-2.0](./LICENSE) © NeevCloud
