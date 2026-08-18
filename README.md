# @neevcloud/sdk

> Official NeevCloud SDK for the Neev platform — Node, Bun, Deno & edge.

`@neevcloud/sdk` is the single, growing TypeScript client for the **Neev platform**.
One package, one auth model, one client — adopt new capabilities as they ship.

> **Using DeepSeek Harness?** [`@neevcloud/dsh-sandbox`](https://github.com/NeevCloudAI/dsh-neev-sandbox) is a DSH plugin built on this SDK that runs the Harness's Bash, PTY, files, and LSP inside a NeevCloud Sandbox — `dsh plugin add @neevcloud/dsh-sandbox`.

**Available today**

- **`neev.sandboxes`** — full agent-sandbox lifecycle: create, list, get, pause, resume, delete, live metrics, plus snapshots, restore, and fork. Inside a running sandbox: `files`, `exec`, a `processes` supervisor for long-running, detached processes, and `pty` for interactive terminal sessions. Sandboxes are strongly isolated compute environments for AI agents.
- **`neev.templates`** — the platform sandbox-template catalogue (list, get). A template id (e.g. `sb-ubuntu-26-04-minimal`) is optional when creating a sandbox; omit it to use the platform's default template.
- **`neev.agents`** — agent lifecycle: create from a catalogue template, list, get, update (in-place egress / cpu / memory), pause, resume, delete. Each agent runs on its own backing sandbox, reachable from the handle via `agent.sandbox()`.
- **`neev.agentTemplates`** — the platform agent-template catalogue (list, get). A template name (e.g. `claude-code`) is passed as `agent_template` when creating an agent.

**Coming next**

- `neev.inference`, `neev.runtimes`, `neev.storage`, … — rolling out in the same package.

---

## Install

```sh
npm install @neevcloud/sdk@beta
# or: pnpm add @neevcloud/sdk@beta · yarn add @neevcloud/sdk@beta · bun add @neevcloud/sdk@beta
```

Requires a server-side JS runtime with global `fetch`: **Node 18+**, **Bun**, **Deno**, or an edge runtime. There is no browser build — your API key must never ship to a browser.

## Authentication

The client reads configuration from explicit options or `NEEV_*` environment variables:

| Option      | Env var                 | Required | Default |
| ----------- | ----------------------- | -------- | ------- |
| `apiKey`    | `NEEV_API_KEY`          | yes      | —       |
| `orgId`     | `NEEV_ORG_ID`           | yes\*    | —       |
| `projectId` | `NEEV_PROJECT_ID`       | yes\*    | —       |
| `baseURL`   | —                       | no       | production API |

\* `orgId` / `projectId` may be set on the client or overridden per call.

`baseURL` defaults to the Neev production API; set it only to target another environment.

## Quickstart

```ts
import { Neev } from "@neevcloud/sdk";

const neev = new Neev({
  apiKey: process.env.NEEV_API_KEY,
  orgId: process.env.NEEV_ORG_ID,
  projectId: process.env.NEEV_PROJECT_ID,
});

// Create a sandbox on the platform defaults and wait for it to come up.
const sandbox = await neev.sandboxes.create({});
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
// `snap` starts Pending — wait until it reaches Ready before restoring from it.
await neev.sandboxes.waitForSnapshot(snap.id);         // resolves once Ready (throws on failure)
await neev.sandboxes.restore(id, snap.id);             // restore in place from the Ready snapshot
const fork = await neev.sandboxes.fork(id, "my-fork"); // fork the current live state (no snapshot needed)
```

### Sandbox templates

`sandbox_template_id` is optional — omit it to use the platform's default template, or pass a known id directly, or browse the catalogue to discover one:

```ts
// Create directly from a known template id.
const sandbox = await neev.sandboxes.create({
  sandbox_template_id: "sb-ubuntu-26-04-minimal",
});

// Or discover what's available first.
const { items } = await neev.templates.list();
const template = await neev.templates.get("sb-ubuntu-26-04-minimal"); // inspect one
```

### Network egress

Sandboxes (and agents) are **deny-all by default** — no outbound network. Open egress at create time with the convenience fields, on either `sandboxes.create` or `agents.create`:

```ts
// allow the whole internet
await neev.sandboxes.create({ name: "web", allowInternet: true });

// allow only specific hosts (FQDN or CIDR; wildcards supported)
await neev.sandboxes.create({ name: "ci", allowEgress: ["github.com", "*.npmjs.org"] });

// same on agents
await neev.agents.create({ name: "coder", agent_template: "claude-code", allowInternet: true });
```

`allowInternet: true` opens `0.0.0.0/0` and `::/0`. For finer control (ports, protocols, a mix of rules) pass a full `egress` object instead — it takes precedence over the convenience fields:

```ts
await neev.sandboxes.create({
  name: "adv",
  egress: {
    mode: "allow_list",
    allow_internet: false,
    allow: [{ host: "api.example.com", ports: [443], protocol: "TCP" }],
  },
});
```

### Sandbox handles

`create`, `get`, and `list` return `Sandbox` handles with lifecycle methods on the object itself:

```ts
const sandbox = await neev.sandboxes.get(id);
await sandbox.refresh();          // re-fetch latest state
await sandbox.waitUntilReady();   // poll until phase === "Ready"
await sandbox.pause();
const snap = await sandbox.snapshot({ waitUntilReady: true }); // capture and wait until Ready
const fork = await sandbox.fork("my-fork"); // branch the current state into a new sandbox
await sandbox.restore(snap.id);             // restore this sandbox in place from the Ready snapshot
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

File paths are workspace-relative (the sandbox rejects absolute paths):

```ts
const sandbox = await neev.sandboxes.get(id);
await sandbox.files.write("main.py", "print('hi')"); // → { bytesWritten }
const bytes = await sandbox.files.read("main.py"); // → Uint8Array
const text = await sandbox.files.readText("main.py"); // → string
const entries = await sandbox.files.list(".", { recursive: true }); // → FileEntry[]

const info = await sandbox.files.stat("main.py"); // → FileEntry
const there = await sandbox.files.exists("main.py"); // → boolean
await sandbox.files.mkdir("out/logs"); // → FileEntry (creates parents)
await sandbox.files.move("main.py", "app.py"); // → FileEntry (moved)
await sandbox.files.remove("out", { recursive: true }); // → void

// Stream filesystem changes as they happen (until the timeout or an abort signal).
for await (const ev of sandbox.files.watch(".", { recursive: true })) {
  console.log(ev.type, ev.path); // e.g. "create app.py"
}

const result = await sandbox.exec(["sh", "-c", "python3 app.py"]); // → { stdout, stderr, exitCode }
```

By default `exec` is buffered — it runs the command to completion and returns captured output; a non-zero `exitCode` is returned, not thrown.

To consume output **as it is produced** (long-running commands, live logs), pass `{ stream: true }`. The same `exec` then returns an async iterable that yields `stdout`/`stderr` text chunks the moment the sandbox flushes them, then a terminal `exit` event:

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

### Interactive terminal (PTY)

For a fully interactive session — a shell, a REPL, anything that needs a TTY — `sandbox.pty` opens a pseudo-terminal over a WebSocket. Output streams to your `onData` callback; you send keystrokes, forward window resizes, and await the exit code:

```ts
const pty = await sandbox.pty.create({
  cols: 80,
  rows: 24,
  onData: (chunk) => process.stdout.write(chunk), // Uint8Array of terminal output
});

pty.sendInput("ls -la\n");      // string or Uint8Array → the terminal's stdin
pty.resize(120, 40);            // on a window-size change
pty.kill("SIGINT");             // signal the process group (default SIGTERM)

const { exitCode } = await pty.wait(); // resolves when the session ends
```

If the connection drops, reattach to the same terminal — `pty.id` names it, and `create({ id })` reconnects (the sandbox replays recent scrollback, so you see what happened while you were away):

```ts
const pty = await sandbox.pty.create({ program: "sh" });
const id = pty.id; // e.g. "pty_a79b1567…" — persist this to reconnect later
pty.disconnect(); // the shell keeps running in the sandbox

// …later, from a fresh process/connection:
const again = await sandbox.pty.create({ id, onData: (c) => process.stdout.write(c) });
```

The PTY needs a `WebSocket`. Browsers, Deno, Bun, and Node 22+ provide one globally. **In Node, pass a WebSocket that can send the auth header** (the global one cannot), e.g. with the [`ws`](https://www.npmjs.com/package/ws) package:

```ts
import WebSocket from "ws";
const neev = new Neev({ webSocket: (url, opts) => new WebSocket(url, opts) });
```

### SSH access

Point any `ssh` client, `scp`/`rsync`, or IDE remote-dev at a sandbox — no keys to manage and no public port. `sandbox.ssh()` opens a local loopback listener that forwards each connection to the sandbox over an authenticated WebSocket, and returns its `host`/`port`:

```ts
const tunnel = await sandbox.ssh(); // binds 127.0.0.1 on a free port
console.log(`ssh -p ${tunnel.port} neev@localhost`);
console.log(`rsync -e "ssh -p ${tunnel.port}" -av ./src neev@localhost:/workspace/`);

await tunnel.close(); // stop the listener when you're done
```

Node only — it opens a local TCP listener. It needs the [`ws`](https://www.npmjs.com/package/ws) package, which it loads automatically (no `webSocket` factory required, unlike the PTY above); `npm install ws` if you don't already have it.

### Preview URLs

Run a server inside the sandbox and get a public, credential-free preview URL for one of its ports. Ports are private until you expose them; `getUrl` exposes the port and waits until the gateway has provisioned the route before returning the URL.

```ts
// Start a web server on port 3000, then get its preview URL.
await sandbox.processes.start(["busybox", "httpd", "-f", "-p", "3000"]);
const url = await sandbox.getUrl({ port: 3000 }); // → "https://3000-….neevsandbox.app"

// Pass { waitUntilReady: false } to skip the readiness wait, and tune it with
// timeoutMs / pollIntervalMs.

// Lower-level control if you need it:
const ports = await sandbox.listPorts(); // → SandboxPort[] ({ port, preview_url })
await sandbox.revokePort(3000); // stop serving the port
```

### Snapshots, fork & restore

Capture a sandbox's state as a **snapshot**, then **restore** the same sandbox back to that snapshot. A snapshot is created `Pending` and must reach `Ready` before it can be restored. Pass `{ waitUntilReady: true }` to block until it is `Ready` (or use `neev.sandboxes.waitForSnapshot(id)`); otherwise read `snapshot.status` yourself. **Fork** is separate: it atomically snapshots a sandbox's *current* live state into a brand-new sandbox (it does not reuse an existing snapshot), and the source keeps running:

```ts
const sandbox = await neev.sandboxes.get(id);

// Capture the sandbox's filesystem state and block until it is Ready.
const snap = await sandbox.snapshot({ name: "checkpoint", waitUntilReady: true });

// Restore the original in place from the snapshot; fork branches the current
// live state into a brand-new sandbox (it does not consume `snap`).
await sandbox.restore(snap.id);             // → this sandbox, restored
const fork = await sandbox.fork("my-fork"); // → a new Sandbox handle

const { items } = await neev.sandboxes.listSnapshots(id); // paginated; pass { page, limit }
await neev.sandboxes.deleteSnapshot(snap.id);
```

Prefer a two-step flow (create now, wait later)? Capture without waiting and poll explicitly:

```ts
const pending = await sandbox.snapshot({ name: "checkpoint" }); // status: "Pending"
const ready = await neev.sandboxes.waitForSnapshot(pending.id); // resolves once Ready
```

The full snapshot example is [`examples/snapshot-fork-restore.ts`](./examples/snapshot-fork-restore.ts).

### Agents

An **agent** is a packaged coding agent (e.g. Claude Code) provisioned from a catalogue template onto its own backing sandbox (1:1). Create one from a template name, wait for it to become `Ready`, then drive its environment through the backing sandbox:

```ts
// Discover available agent templates (or pass a known name directly).
const { items } = await neev.agentTemplates.list();
const template = await neev.agentTemplates.get("ag-claude-code");

// Provision an agent from a template. It starts `Provisioning`; wait for `Ready`.
const agent = await neev.agents.create({
  name: "my-coder",
  agent_template: "claude-code",
});
await agent.waitUntilReady();
console.log(agent.id, agent.status, agent.sandboxId);

// Reach the agent's environment (files / exec / processes) via its backing sandbox.
const sandbox = await agent.sandbox();
await sandbox.files.write("notes.md", "# scratch\n");
const { stdout } = await sandbox.exec(["ls", "-la"]);

// Resize cpu/memory or change egress in place (no recreate); disk is not resizable.
await agent.update({ resources: { cpu: 2, memory_gb: 4 } });

// Pause to release compute, resume on demand, delete when done.
await agent.pause();
await agent.resume();
await agent.delete();
```

Resource methods mirror the handle: `neev.agents.list/create/get/update/pause/resume/delete`, and `neev.agentTemplates.list/get`. The full example is [`examples/create-agent.ts`](./examples/create-agent.ts).

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
