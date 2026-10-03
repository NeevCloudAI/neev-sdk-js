# @neevcloud/sdk

> Official NeevCloud SDK for the Neev platform — Node, Bun, Deno & edge.

`@neevcloud/sdk` is the single, growing TypeScript client for the **Neev platform**.
One package, one auth model, one client — adopt new capabilities as they ship.

> **Using DeepSeek Harness?** [`@neevcloud/dsh-sandbox`](https://github.com/NeevCloudAI/dsh-neev-sandbox) is a DSH plugin built on this SDK that runs the Harness's Bash, PTY, files, and LSP inside a NeevCloud Sandbox — `dsh plugin add @neevcloud/dsh-sandbox`.

**Available today**

- **`neev.sandboxes`** — full agent-sandbox lifecycle: create (catalogue template or BYOI image), list, get (by id or name), update (in-place resize + egress, or an in-place allow-list edit), pause, resume, keepalive, timeout windows, delete, live metrics, an audit trail of what ran, preview URLs for ports, plus snapshots, rollback, and fork. Inside a running sandbox: `files` (including resumable chunked uploads and local-disk `uploadFile` / `downloadFile`), `exec`, a `processes` supervisor for long-running, detached processes, `pty` for interactive terminal sessions, and `ssh`. Sandboxes are strongly isolated compute environments for AI agents.
- **`neev.templates`** — the platform sandbox-template catalogue (list, get). A template id (e.g. `sb-ubuntu-26-04-minimal`) is optional when creating a sandbox; omit it to use the platform's default template.
- **`neev.agents`** — agent lifecycle: create from a catalogue template, list, get (by id or name), update (in-place egress / cpu / memory / idle window), pause, resume, keepalive, rollback, preview URLs, audit trail, delete. Each agent runs on its own backing sandbox, reachable from the handle via `agent.sandbox()`.
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
const paused = await neev.sandboxes.list({ name: "web", status: "Paused" });
const sandbox = await neev.sandboxes.get(id); // by id, or by name: neev.sandboxes.get("my-sandbox")
await neev.sandboxes.pause(id);
await neev.sandboxes.resume(id);
await neev.sandboxes.delete(id);
const metrics = await neev.sandboxes.metrics(id, { step: "60s" });

// Update a running sandbox in place: resize cpu/memory and/or re-scope egress
// (at least one required; disk is not resizable in place; egress needs no restart).
await neev.sandboxes.update(id, { resources: { cpu: 2, memory_gb: 4 } });
await neev.sandboxes.update(id, { allowEgress: ["api.github.com"] });
// Or edit the allow-list in place without restating it (removals apply first).
await neev.sandboxes.update(id, { egress_add: { allow: [{ host: "pypi.org", ports: [443] }] } });

// What ran inside the sandbox, newest first (see "Audit trail" below).
const trail = await neev.sandboxes.audit(id, { limit: 50 });

// Lifecycle windows (all in seconds). keepalive resets the idle timer; updateTimeout
// changes only the windows passed (send 0 to turn one off, omit to leave unchanged).
await neev.sandboxes.keepalive(id);
await neev.sandboxes.updateTimeout(id, { idle_timeout_seconds: 600, on_idle: "pause" });

// Snapshots, rollback, and fork (see "Snapshots, fork & rollback" below).
const snap = await neev.sandboxes.createSnapshot(id, { name: "checkpoint" });
const { items } = await neev.sandboxes.listSnapshots(id); // paginated
// `snap` starts Pending — wait until it reaches Ready before rolling back to it.
await neev.sandboxes.waitForSnapshot(snap.id);         // resolves once Ready (throws on failure)
await neev.sandboxes.rollback(id, snap.id);            // roll back in place to the Ready snapshot
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
template.icon; // display icon (e.g. an SVG document) or null
```

### Custom images (BYOI)

Instead of a catalogue template, create from any public OCI image with an explicit
tag or digest, and optionally override the start command. Set at most one of
`sandbox_template_id` or `image` (omit both to use the platform default template):

```ts
const sandbox = await neev.sandboxes.create({
  image: "docker.io/library/python:3.12-slim",
  command: ["sleep", "infinity"], // keep it alive to exec into
});
```

### Lifecycle windows

Cap how long a sandbox lives and what happens when it goes idle. Durations are in
seconds. Set windows at create time, change them in place with `updateTimeout`, and
reset the idle timer with `keepalive`:

```ts
// At create time: pause after 10 min idle, hard-stop after 2 h total.
const sandbox = await neev.sandboxes.create({
  lifecycle: { idle_timeout_seconds: 600, max_lifetime_seconds: 7200, on_idle: "pause" },
});

// Reset the idle timer while work is in progress (e.g. once per agent turn).
await sandbox.keepalive();

// Change only the windows passed; send 0 to turn one off, omit to leave unchanged.
await sandbox.updateTimeout({ idle_timeout_seconds: 0, max_lifetime_seconds: 3600 });
```

`on_idle` is `"pause"` or `"delete"`. Omit `lifecycle` entirely to use the account
defaults (no lifecycle key is sent).

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

`allowInternet: true` allows all outbound traffic (`0.0.0.0/0` and `::/0`). For finer control (ports, protocols, a mix of rules) pass a full `egress` object instead — it takes precedence over the convenience fields. A rule's `ports` limit it to those destination ports (omit for every port), and `protocol` defaults to `TCP` when `ports` is set:

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

On a running sandbox or agent, `update` either replaces the policy in full with `egress`, or edits the existing allow-list in place with `egress_add` / `egress_remove` (removals apply first, so one call can swap a host). The two styles can't be combined in one call, and `egress_add` needs the sandbox to already be in `allow_list` mode:

```ts
await sandbox.update({
  egress_remove: { allow: [{ host: "old-api.example.com" }] },
  egress_add: { allow: [{ host: "api.example.com", ports: [443] }] },
});
```

### Sandbox handles

`create`, `get`, and `list` return `Sandbox` handles with lifecycle methods on the object itself:

```ts
const sandbox = await neev.sandboxes.get(id);
await sandbox.refresh();          // re-fetch latest state
sandbox.lastCrash;                // null, or { reason, at, storage_reset } for the last unexpected stop
const trail = await sandbox.audit(); // one page of the audit trail
await sandbox.waitUntilReady();   // poll until phase === "Ready" and the sandbox is addressable
sandbox.addressable;              // false for a moment after create; runtime calls wait for it
await sandbox.update({ resources: { cpu: 2, memory_gb: 4 } }); // resize (or re-scope egress) in place
await sandbox.pause();
const snap = await sandbox.snapshot({ waitUntilReady: true }); // capture and wait until Ready
const fork = await sandbox.fork("my-fork"); // branch the current state into a new sandbox
await sandbox.rollback(snap.id);            // roll this sandbox back in place to the Ready snapshot
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
    console.error(err.status, err.code, err.message, err.requestId);
  }
}
```

`err.code` is a machine-readable classification (`not_found`, `validation_error`, `sandbox_quota_exceeded`, …; see the `ErrorCode` type) — branch on it rather than on the message text. Quota refusals also carry `err.scope` (`organization` or `project`). A `503` surfaces as `ServiceUnavailableError`, a subclass of `InternalServerError`.

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

File paths are relative to the workspace, or absolute inside it (a path outside the workspace is refused):

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

// Large files: write() sends anything over 1 MiB in resumable chunks automatically.
// upload() does the same for a string, Uint8Array, ArrayBuffer or Blob, with progress.
await sandbox.files.upload("data.bin", bigBlob, {
  onProgress: (sent, total) => console.log(`${sent}/${total}`),
}); // → { bytesWritten }

// Node only: move files between the local disk and the sandbox without buffering them.
await sandbox.files.uploadFile("./model.bin", "model.bin"); // → { bytesWritten }
await sandbox.files.downloadFile("results.tar", "./results.tar"); // → { bytesWritten }

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

These calls are **not** retried automatically (a retried `write` could run twice) — handle retries yourself if needed. The exception is a chunked upload: a chunk that fails in transit resumes from the last byte the sandbox received rather than starting over, and an upload that cannot finish is cancelled before the error is thrown.

`upload` and `uploadFile` take `{ chunkSize?, cwd?, onProgress?, signal? }`; `chunkSize` is 64 KiB to 1 MiB (the default, and the most one request can carry); a smaller chunk loses less to a dropped connection. `downloadFile` writes to a temporary file next to the destination and renames it into place once the whole file has arrived, so a failed download leaves nothing behind. The full example is [`examples/upload-download.ts`](./examples/upload-download.ts).

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

### Code interpreter

A sandbox created from the interpreter template runs Python in persistent kernels. Variables, imports and loaded data stay between runs in the same context, so each run builds on the last:

```ts
const sandbox = await neev.sandboxes.create({ sandbox_template_id: "sb-ubuntu-26-04-interpreter" });

await sandbox.code.run("import pandas as pd\ndf = pd.DataFrame({'x': [1, 2, 3]})");
const run = await sandbox.code.run("print(df.x.sum())\ndf.describe()", {
  onStdout: (out) => process.stdout.write(out.line), // { line, timestamp, error } as it arrives
});
run.stdout;          // "6\n"
run.text;            // the last expression's text, here the describe() table
run.results[0].html; // typed accessors: text, html, markdown, svg, png, jpeg, pdf, latex, json; formats()
run.executionCount;  // 2
run.endReason;       // "ok"
```

Code that raises is returned, not thrown: `endReason` is `"error"` and `run.error` holds `{ name, value, traceback }`. A run that outlives `timeoutMs` is interrupted with `endReason: "deadline_exceeded"` and the context keeps its state; `"kernel_restarted"` and `"memory_exceeded"` mean the state was lost, which `run.generation` changing also tells you. A run on a context that is still busy throws an `APIError` with `reason: "context_busy"`.

Run options: `context` (a context or its id), `language` (`"python"`, the default context's language), `envs` (environment variables for this run only, seen by subprocesses too), `timeoutMs` (the cell's timeout; the sandbox's ceiling is the default), `requestTimeoutMs` (a bound on the whole request), `signal`, and the `onStdout` / `onStderr` / `onResult` / `onError` callbacks. `run.logs` holds the output pieces as they arrived.

```ts
await sandbox.code.run("import os, subprocess\nprint(os.environ['STAGE'])", { envs: { STAGE: "test" } });
```

Each context is a separate kernel with its own state, started in its own working directory; a run sent while its kernel is still starting waits for it. Runs without a `context` use the `default` context:

```ts
const ctx = await sandbox.code.createContext({ cwd: "project" }); // → { contextId, generation, language, cwd }
await sandbox.code.run("import os\nprint(os.getcwd())", { context: ctx });
await sandbox.code.listContexts();       // → [{ contextId, state, generation, language, cwd, rssMib }]
await sandbox.code.restartContext(ctx);  // drops its state, returns the new generation
await sandbox.code.deleteContext(ctx);
```

The full example is [`examples/code-interpreter.ts`](./examples/code-interpreter.ts).

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

Run a server inside the sandbox and get a public, credential-free preview URL for one of its ports. Ports are private until you expose them; `getUrl` exposes the port and waits until the URL is reachable before returning it.

```ts
// Start a web server on port 3000, then get its preview URL.
await sandbox.processes.start(["busybox", "httpd", "-f", "-p", "3000"]);
const url = await sandbox.getUrl({ port: 3000 });

// Pass { waitUntilReady: false } to skip the readiness wait, and tune it with
// timeoutMs / pollIntervalMs.

// Lower-level control if you need it:
const ports = await sandbox.listPorts(); // → SandboxPort[] ({ port, slug, preview_url })
await sandbox.revokePort(3000); // stop serving the port
```

The URL needs no credential: a random slug in it is the only thing gating the port, so treat the URL as a secret. If one leaks, rotate it by exposing the port again with a different slug — the old URL stops working:

```ts
const rotated = await sandbox.exposePort(3000, { slug: "k3x9q2ab" }); // 8 lowercase letters/digits
console.log(rotated.preview_url);
```

A slug you choose is a name, not a secret — leave it out to get a random one for anything you wouldn't publish. The full example is [`examples/preview-url.ts`](./examples/preview-url.ts).

### Audit trail

Read what ran inside a sandbox — terminal commands, SSH, process and file operations — newest first, with the credential each was made under and how it ended. Only the program name is recorded, never its arguments, and nothing typed at a hidden password prompt is captured:

```ts
let page = await sandbox.audit({ limit: 50 }); // optional from / to (RFC3339), cursor, limit
for (const r of page.records) console.log(r.at, r.tool, r.command ?? r.target ?? "", r.outcome);

// Page back through the window with next_cursor.
while (page.next_cursor) page = await sandbox.audit({ cursor: page.next_cursor });
```

The trail covers the last `retention_days` days; `window_truncated` is true when `from` reaches further back than that. The full example is [`examples/audit-trail.ts`](./examples/audit-trail.ts).

### Snapshots, fork & rollback

Capture a sandbox's state as a **snapshot**, then **roll back** the same sandbox to that snapshot. A snapshot is created `Pending` and must reach `Ready` before it can be rolled back to. Pass `{ waitUntilReady: true }` to block until it is `Ready` (or use `neev.sandboxes.waitForSnapshot(id)`); otherwise read `snapshot.status` yourself. **Fork** is separate: it atomically snapshots a sandbox's *current* live state into a brand-new sandbox (it does not reuse an existing snapshot), and the source keeps running:

```ts
const sandbox = await neev.sandboxes.get(id);

// Capture the sandbox's filesystem state and block until it is Ready.
const snap = await sandbox.snapshot({ name: "checkpoint", waitUntilReady: true });

// Roll the original back in place to the snapshot; fork branches the current
// live state into a brand-new sandbox (it does not consume `snap`).
await sandbox.rollback(snap.id);            // → this sandbox, rolled back
const fork = await sandbox.fork("my-fork"); // → a new Sandbox handle

const { items } = await neev.sandboxes.listSnapshots(id); // paginated; pass { page, limit }
await neev.sandboxes.deleteSnapshot(snap.id);
```

Prefer a two-step flow (create now, wait later)? Capture without waiting and poll explicitly:

```ts
const pending = await sandbox.snapshot({ name: "checkpoint" }); // status: "Pending"
const ready = await neev.sandboxes.waitForSnapshot(pending.id); // resolves once Ready
```

The full snapshot example is [`examples/snapshot-fork-rollback.ts`](./examples/snapshot-fork-rollback.ts).

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

// Resize cpu/memory, change egress, or set the idle window in place (no recreate);
// disk is not resizable.
await agent.update({ resources: { cpu: 2, memory_gb: 4 } });
await agent.update({ idle_timeout_seconds: 900 }); // 0 = no idle limit
agent.idleTimeoutSeconds; // null when the account default applies

// Keep a busy agent from idling out, e.g. once per agent turn.
await agent.keepalive();

// Preview URLs and the audit trail work just like they do on a sandbox.
const url = await agent.getUrl({ port: 3000 });
const trail = await agent.audit({ limit: 50 }); // trail.sandbox_id is the backing sandbox

// Roll the agent back in place to a snapshot of its backing sandbox.
await agent.rollback(snapshotId);

// Pause to release compute, resume on demand, delete when done.
await agent.pause();
await agent.resume();
await agent.delete();
```

Resource methods mirror the handle: `neev.agents.list/create/get/update/keepalive/rollback/pause/resume/delete`, `neev.agents.exposePort/listPorts/revokePort/getPortUrl/audit`, and `neev.agentTemplates.list/get`. `get` and every other method take an agent id or its name. The full examples are [`examples/create-agent.ts`](./examples/create-agent.ts) and [`examples/agent-ports-audit.ts`](./examples/agent-ports-audit.ts).

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
