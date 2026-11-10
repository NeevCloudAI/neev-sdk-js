# Sandboxes

A sandbox is an isolated machine for running code, commands and servers. You create it
from a template, work inside it, and pause or delete it when you are done. Every method
that takes a sandbox id also accepts its name.

| Capability | API | Example |
| --- | --- | --- |
| [Sandbox lifecycle](#sandbox-lifecycle) | `neev.sandboxes.create / list / get / update / delete`, `sandbox.metrics` | [`create-sandbox.ts`](../examples/create-sandbox.ts) |
| [Templates](#templates) | `neev.templates.list / get` | [`docker.ts`](../examples/docker.ts) |
| [Commands and processes](#commands-and-processes) | `sandbox.exec`, `sandbox.processes` | [`processes.ts`](../examples/processes.ts) |
| [Files](#files) | `sandbox.files` | [`files.ts`](../examples/files.ts) |
| [Code interpreter](#code-interpreter) | `sandbox.code` | [`code-interpreter.ts`](../examples/code-interpreter.ts) |
| [Terminals and SSH](#terminals-and-ssh) | `sandbox.pty`, `sandbox.ssh()` | [`pty.ts`](../examples/pty.ts) |
| [Preview URLs](#preview-urls) | `sandbox.getUrl`, `sandbox.exposePort` | [`preview-url.ts`](../examples/preview-url.ts) |
| [Network egress](#network-egress) | `allowInternet`, `allowEgress`, `egress`, `egress_add` | [`update-resize-egress.ts`](../examples/update-resize-egress.ts) |
| [Snapshots, fork and rollback](#snapshots-fork-and-rollback) | `sandbox.snapshot / fork / rollback` | [`snapshot-fork-rollback.ts`](../examples/snapshot-fork-rollback.ts) |
| [Labels](#labels) | `labels` on create and list | [`labels.ts`](../examples/labels.ts) |
| [Audit trail](#audit-trail) | `sandbox.audit` | [`audit-trail.ts`](../examples/audit-trail.ts) |
| [Pause and wake](#pause-and-wake) | `sandbox.pause / resume`, wake on use | [`auto-resume.ts`](../examples/auto-resume.ts) |

## Sandbox lifecycle

`create`, `get` and `list` return a `Sandbox` handle. Its methods act on that sandbox and
keep the handle up to date.

```ts
const sandbox = await neev.sandboxes.create({
  name: "web",
  sandbox_template_id: "sb-ubuntu-26-04-dev",
  resources: { cpu: 2, memory_gb: 4, disk_gb: 20 },
  env: [{ name: "APP_ENV", value: "dev" }],
});
await sandbox.waitUntilReady();

const same = await neev.sandboxes.get("web"); // by id or name
const { items } = await neev.sandboxes.list({ status: "Ready", limit: 50 });

await sandbox.update({ resources: { cpu: 4, memory_gb: 8 } }); // resize in place
await sandbox.delete();
```

| Resource | Allowed values |
| --- | --- |
| `cpu` | 0.5 to 8 vCPUs, in steps of 0.5 |
| `memory_gb` | 1 to 16 GB |
| `disk_gb` | 10 to 100 GB, in steps of 10 |
| `rootfs_disk_gb` | The part of `disk_gb` kept for the system outside `/workspace`; less than `disk_gb`, default 20% of it (at least 4). Raise it when installs write outside `/workspace` |

Omitted fields take the default: 1 vCPU, 2 GB memory, 10 GB disk. `update` resizes CPU
and memory without a restart; `disk_gb` and `rootfs_disk_gb` are fixed at create time.

Lifecycle windows stop a sandbox from running forever. Durations are in seconds.

| Option | Meaning |
| --- | --- |
| `idle_timeout_seconds` | Act after this long with no activity |
| `on_idle` | `"pause"` or `"delete"` |
| `max_lifetime_seconds` | Hard limit on total lifetime |
| `paused_retention_seconds` | How long a paused sandbox is kept |

Set them in `lifecycle` at create time, change them with `sandbox.updateTimeout(...)` (`0`
turns a window off), and reset the idle timer with `sandbox.keepalive()`:

```ts
const job = await neev.sandboxes.create({
  lifecycle: { idle_timeout_seconds: 600, on_idle: "pause", max_lifetime_seconds: 7200 },
});
await job.keepalive();
await job.updateTimeout({ max_lifetime_seconds: 0 });
```

Read CPU, memory and disk usage over a time window with `sandbox.metrics()`. The window is
the last hour unless you pass `from` and `to` (RFC 3339).

```ts
const metrics = await sandbox.metrics({ step: "60s" });
```

`sandbox.lastCrash` is the most recent unexpected stop, or `null`. `storage_reset: true`
means the sandbox restarted with an empty filesystem. It is historical, so compare its
`at` with when you last trusted the files.

See [`create-sandbox.ts`](../examples/create-sandbox.ts) · [`lifecycle-keepalive.ts`](../examples/lifecycle-keepalive.ts) · [`sandbox-metrics.ts`](../examples/sandbox-metrics.ts) · [`last-crash.ts`](../examples/last-crash.ts) · [reference](./api-reference.md#neevsandboxes)

## Templates

A template is the image a sandbox starts from. Omit `sandbox_template_id` to use the
default, or pick one from the catalogue.

```ts
const { items } = await neev.templates.list();
const template = await neev.templates.get("sb-ubuntu-26-04-dev");
```

Templates you can start from:

| Template | Use it for |
| --- | --- |
| `sb-ubuntu-26-04-dev` | General development: git, gh, Python 3, Node 24 LTS |
| `sb-ubuntu-26-04-docker` | Docker, Compose and Buildx, with Docker started at boot; run containers with `--network=host` |
| `sb-ubuntu-26-04-interpreter` | The [code interpreter](#code-interpreter): Python kernels that keep their state |
| `sb-ubuntu-26-04-playwright` | Browser testing: a desktop with Node 24, Playwright and Chromium, headless or headed (`DISPLAY=:1`) |

The catalogue grows over time, so `templates.list()` is the source of truth. To use your
own image instead, pass `image` (a public OCI image with a tag or digest) and, if it needs
one, a start `command`:

```ts
const custom = await neev.sandboxes.create({
  image: "docker.io/library/python:3.12-slim",
  command: ["sleep", "infinity"],
});
```

Playwright and Chromium come preinstalled on the Playwright template, so a project that
pins the same Playwright version runs its tests with nothing to download:

```ts
const browser = await neev.sandboxes.create({ sandbox_template_id: "sb-ubuntu-26-04-playwright" });
await browser.waitUntilReady();
const run = await browser.exec(["npx", "playwright", "test"], { cwd: "app", timeoutMs: 300_000 });
```

See [`docker.ts`](../examples/docker.ts) · [`byoi-create.ts`](../examples/byoi-create.ts) · [reference](./api-reference.md#templates)

## Commands and processes

`exec` runs a command to completion and returns its output. A non-zero exit code is
returned, not thrown. The command runs directly, without a shell; use `sh -c` for pipes,
`&&` and redirects.

```ts
const { stdout, stderr, exitCode } = await sandbox.exec(["ls", "-la"]);
await sandbox.exec(["sh", "-c", "pip install -r requirements.txt && pytest -q"], {
  cwd: "app",
  env: { CI: "1" },
  timeoutMs: 300_000,
});

// Stream output as it is produced.
for await (const event of sandbox.exec(["npm", "test"], { stream: true })) {
  if (event.type === "stdout") process.stdout.write(event.data);
  else if (event.type === "exit") console.log("exit", event.exitCode);
}
```

A command that prints nothing for about 2 minutes is cut off by the network in front of
the sandbox, whatever its `timeoutMs`, and may keep running. Stream it, or start quiet
and long jobs as a background process.

For work that should outlive one call, such as a dev server or a watcher, start a
background process instead. It keeps running after the call returns.

```ts
const proc = await sandbox.processes.start("npm", { args: ["run", "dev"], cwd: "app" });
const page = await proc.logs({ cursor: 0 }); // poll; or follow() to stream
await proc.kill();
const final = await proc.wait(); // { state: "exited", exitCode, ... }
```

`sandbox.processes.list()` shows every tracked process and `killAll()` stops them all.

See [`processes.ts`](../examples/processes.ts) · [`streaming-exec.ts`](../examples/streaming-exec.ts) · [`process-pool.ts`](../examples/process-pool.ts) · [reference](./api-reference.md#commands-and-processes)

## Files

Paths are relative to the sandbox workspace, or absolute inside it. A path outside the
workspace is refused.

```ts
await sandbox.files.write("main.py", "print('hi')");
const text = await sandbox.files.readText("main.py");
const head = await sandbox.files.read("big.log", { offset: 0, length: 4096 }); // a byte range
const entries = await sandbox.files.list(".", { recursive: true });

await sandbox.files.move("main.py", "app.py");
await sandbox.files.remove("build", { recursive: true });

for await (const change of sandbox.files.watch(".", { recursive: true })) {
  console.log(change.type, change.path);
}
```

Writes over 1 MiB are sent in resumable chunks automatically; `files.upload` does the same
for a string, `Uint8Array`, `ArrayBuffer` or `Blob`, with progress. In Node, `uploadFile`
and `downloadFile` move files between local disk and the sandbox without holding them in
memory, and a failed download leaves no partial file.

```ts
await sandbox.files.uploadFile("./data.tar", "data.tar", {
  onProgress: (sent, total) => console.log(`${sent}/${total}`),
});
await sandbox.files.downloadFile("out/report.pdf", "./report.pdf");
```

See [`files.ts`](../examples/files.ts) · [`upload-download.ts`](../examples/upload-download.ts) · [reference](./api-reference.md#files)

## Code interpreter

Sandboxes created from `sb-ubuntu-26-04-interpreter` run Python in kernels that keep
their state between runs.

```ts
const sandbox = await neev.sandboxes.create({ sandbox_template_id: "sb-ubuntu-26-04-interpreter" });

await sandbox.code.run("import pandas as pd\ndf = pd.DataFrame({'x': [1, 2, 3]})");
const run = await sandbox.code.run("int(df.x.sum())");
console.log(run.text); // "6"
```

An exception in your code is returned in `run.error` with `endReason: "error"`, not
thrown. `onStdout`, `onStderr` and `onResult` see output as it arrives, and `run.results`
holds rich values such as HTML or a PNG chart. Use `sandbox.code.createContext()` for
separate kernels with their own state; a changed `run.generation` means a context lost its
state.

```ts
const ctx = await sandbox.code.createContext({ cwd: "project" });
await sandbox.code.run("import os; print(os.getcwd())", { context: ctx });
await sandbox.code.deleteContext(ctx);
```

On any other template, every `sandbox.code` call fails with reason
`interpreter_not_enabled`.

See [`code-interpreter.ts`](../examples/code-interpreter.ts) · [reference](./api-reference.md#code-interpreter)

## Terminals and SSH

`sandbox.pty` opens an interactive terminal. You send keystrokes and receive output
through a callback.

```ts
const pty = await sandbox.pty.create({ cols: 80, rows: 24, onData: (c) => process.stdout.write(c) });
pty.sendInput("ls -la\n");
const { exitCode } = await pty.wait();

// Reattach after a dropped connection; recent output is replayed.
const again = await sandbox.pty.create({ id: pty.id, onData: (c) => process.stdout.write(c) });
```

In Node, the terminal needs a WebSocket that can send headers. Install
[`ws`](https://www.npmjs.com/package/ws) and pass it as the `webSocket` option (see
[Client options](./configuration.md#client-options)).

`sandbox.ssh()` opens a local port that forwards to the sandbox, so `ssh`, `scp`,
`rsync` and IDE remote development work with no keys to manage. It runs on Node and loads
`ws` itself.

```ts
const tunnel = await sandbox.ssh();
console.log(`ssh -p ${tunnel.port} neev@localhost`);
await tunnel.close();
```

See [`pty.ts`](../examples/pty.ts) · [`ssh-tunnel.ts`](../examples/ssh-tunnel.ts) · [reference](./api-reference.md#terminals-and-ssh)

## Preview URLs

Expose a port and get a public HTTPS URL for it. Start your server first, bound to
`0.0.0.0`; `getUrl` waits until the URL answers.

```ts
await sandbox.processes.start("python3", { args: ["-m", "http.server", "3000"] });
const url = await sandbox.getUrl({ port: 3000 });
```

Anyone with the URL can open it without signing in, so treat it as a secret.

```ts
const ports = await sandbox.listPorts();
await sandbox.exposePort(3000, { slug: "k3x9q2ab" }); // a new slug replaces the URL
await sandbox.revokePort(3000); // close it
```

See [`preview-url.ts`](../examples/preview-url.ts) · [reference](./api-reference.md#neevsandboxes)

## Network egress

A sandbox has no outbound network unless you allow it, apart from any its template
allows (the Docker template allows Docker Hub and GHCR). Open what it needs at create
time, and change it later without a restart.

```ts
await neev.sandboxes.create({ allowInternet: true });
await neev.sandboxes.create({ allowEgress: ["github.com", "*.npmjs.org"] });

// Replace the policy in full.
await sandbox.update({ allowEgress: ["api.github.com"] });

// Edit the allow-list in place, leaving every other rule alone.
await sandbox.update({ egress_add: { allow: [{ host: "pypi.org", ports: [443] }] } });
await sandbox.update({ egress_remove: { allow: [{ host: "github.com" }] } });
```

A host is a domain, a `*.` wildcard, or an IP address or CIDR range. For ports and
protocols on a whole policy, pass `egress` instead. `egress_add` needs the sandbox to
already have an allow-list, and neither edit can be combined with `egress`,
`allowInternet` or `allowEgress`; a conflicting update throws before any request is sent.

See [`update-resize-egress.ts`](../examples/update-resize-egress.ts) · [reference](./api-reference.md#neevsandboxes)

## Snapshots, fork and rollback

A snapshot captures a sandbox's full state: its files and the memory of its running
processes. Roll the sandbox back to it later, fork the sandbox's current state into a new
one, or restore a snapshot into a new sandbox.

```ts
const snap = await sandbox.snapshot({ name: "checkpoint", waitUntilReady: true });
await sandbox.rollback(snap.id); // back to the snapshot, in place
const copy = await sandbox.fork("my-fork"); // a new sandbox from the current state
const restored = await neev.sandboxes.create({ restore: snap.id }); // a new sandbox from the snapshot

const { items } = await sandbox.snapshots();
await neev.sandboxes.deleteSnapshot(snap.id);
```

A snapshot starts `Pending` and must be `Ready` before you roll back to it or restore it.
Pass `waitUntilReady: true`, or call `neev.sandboxes.waitForSnapshot(id)` later. Pass
`snapshot_type: "filesystem"` to capture `/workspace` only, which restores onto any
sandbox image.

See [`snapshot-fork-rollback.ts`](../examples/snapshot-fork-rollback.ts) · [reference](./api-reference.md#snapshots-fork-and-rollback)

## Labels

Labels are key-value tags you attach at create time and filter by later.

```ts
await neev.sandboxes.create({ labels: { team: "payments", "ci-run": "4821" } });
const { items } = await neev.sandboxes.list({ labels: { team: "payments" } });
console.log(items[0]?.labels);
```

A sandbox takes up to 16 labels; `list({ labels })` keeps only sandboxes that carry every
label you give. A malformed label is rejected with `BadRequestError`.

See [`labels.ts`](../examples/labels.ts) · [reference](./api-reference.md#neevsandboxes)

## Audit trail

Read what happened inside a sandbox, newest first, as [OCSF 1.9.0](https://schema.ocsf.io/1.9.0/)
events in three classes:

| `class_uid` | Class | What it records |
| --- | --- | --- |
| `6003` | API Activity | A call made to the sandbox: `exec`, a terminal command, a file operation, a process start, SSH, a code cell |
| `1007` | Process Activity | Every program that ran in it, including ones no call asked for |
| `4001` | Network Activity | Every connection those programs opened |

```ts
const trail = await sandbox.audit({ limit: 50 });
for (const e of trail.data) {
  // Only API Activity events have api; a program or connection names its process instead.
  const what = e.api?.operation ?? e.process?.name ?? e.actor.process?.name;
  console.log(new Date(e.time).toISOString(), e.type_name, what, e.status);
}
```

Filter with `status` (every class), or `operation`, `actorType`, `actorUid` and
`credentialUid` (calls only), and page back with `cursor: trail.next_cursor`. Programs
are recorded by name only, never with their arguments. Calls take a few seconds to
appear, programs and connections about a minute.

Recording programs and connections is on by default. Turn it off, without a restart,
with `execution_trace`; calls are still recorded, and `sandbox.executionTrace` shows the
setting.

```ts
await sandbox.update({ execution_trace: false });
```

See [`audit-trail.ts`](../examples/audit-trail.ts) · [reference](./api-reference.md#audit-trail)

## Pause and wake

Pausing stops paying for compute and keeps the sandbox's files and running processes.

```ts
await sandbox.pause();
await sandbox.resume();
```

You don't have to resume a paused sandbox before using it. Runtime calls (`exec`,
`files`, `processes`, `code`, `pty`) on a `Paused` sandbox that still has a `connectUrl`
are sent to it, and where the platform's automatic wake-up is enabled, the sandbox wakes
and the call completes: one slow response instead of an error. Give the client a
`timeoutMs` long enough for the wake-up.

Where automatic wake-up is off, the call fails with `RateLimitError` (429). Call
`resume()` and retry it, but only replay a command that is safe to run twice.

```ts
import { RateLimitError } from "@neevcloud/sdk";

try {
  await sandbox.exec(["cat", "notes.txt"]);
} catch (err) {
  if (!(err instanceof RateLimitError)) throw err;
  await sandbox.refresh();
  if (sandbox.phase !== "Paused") throw err;
  await sandbox.resume();
  while (sandbox.phase === "Paused") {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await sandbox.refresh();
  }
  await sandbox.waitUntilReady();
  await sandbox.exec(["cat", "notes.txt"]);
}
```

`waitUntilReady()` on a `Paused` handle still throws at once, because a paused sandbox
doesn't become Ready by itself; wait for the phase to leave `Paused` first, as above.
`sandbox.code` calls keep retrying for up to two minutes while a sandbox wakes.

See [`auto-resume.ts`](../examples/auto-resume.ts) · [reference](./api-reference.md#sandbox-handle)
