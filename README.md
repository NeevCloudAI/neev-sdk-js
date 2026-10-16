# NeevCloud SDK for TypeScript

The official TypeScript client for NeevCloud, published as `@neevcloud/sdk`.

[![npm](https://img.shields.io/npm/v/@neevcloud/sdk)](https://www.npmjs.com/package/@neevcloud/sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![CI](https://github.com/NeevCloudAI/neev-sdk-js/actions/workflows/ci.yml/badge.svg)](https://github.com/NeevCloudAI/neev-sdk-js/actions/workflows/ci.yml)

One package for the NeevCloud products you build with: Sandboxes, Agents and Agent tools
today, with more to come. It runs on Node, Bun, Deno and edge runtimes, with one client,
one API key, and typed requests, responses and errors.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Products](#products)
- [Sandboxes](#sandboxes)
- [Agents](#agents)
- [Agent tools](#agent-tools)
- [Errors](#errors)
- [Configuration](#configuration)
- [Examples](#examples)
- [Documentation](#documentation)
- [Security](#security)
- [License](#license)

## Install

```sh
npm install @neevcloud/sdk
# or
pnpm add @neevcloud/sdk
bun add @neevcloud/sdk
```

Runs on Node 18+, Bun, Deno and edge runtimes with a global `fetch`. It is a
server-side SDK: never ship your API key to a browser.

## Quick start

Set your credentials:

```sh
export NEEV_API_KEY="your-api-key"
export NEEV_ORG_ID="your-org-id"
export NEEV_PROJECT_ID="your-project-id"
```

Find your organization and project IDs as described in [Organizations and projects](https://docs.ai.neevcloud.com/getting-started/org-and-project#find-your-organization-id-and-project-id).

Create a sandbox, run a command, read a file, and clean up:

```ts
import { Neev } from "@neevcloud/sdk";

const neev = new Neev(); // reads the NEEV_* variables

const sandbox = await neev.sandboxes.create({ sandbox_template_id: "sb-ubuntu-26-04-dev" });

try {
  await sandbox.waitUntilReady();
  const { stdout } = await sandbox.exec(["python3", "-c", "print(6 * 7)"]);
  console.log(stdout); // 42

  await sandbox.files.write("hello.txt", "hello from NeevCloud\n");
  console.log(await sandbox.files.readText("hello.txt"));
} finally {
  await sandbox.delete();
}
```

## Products

| Product | What it is | Entry point | Guide |
| --- | --- | --- | --- |
| Sandboxes | Isolated machines that run your code, commands and servers | `neev.sandboxes`, `neev.templates` | [Sandboxes](#sandboxes) |
| Agents | Ready-made coding agents, such as Claude Code, each on its own sandbox | `neev.agents`, `neev.agentTemplates` | [Agents](#agents) |
| Agent tools | A sandbox tool set, with model-ready schemas, for the agent you build | `@neevcloud/sdk/agent-tools` | [Agent tools](#agent-tools) |

## Sandboxes

A sandbox is an isolated machine for running code, commands and servers. You create it
from a template, work inside it, and pause or delete it when you are done.

| Capability | API | Example |
| --- | --- | --- |
| [Sandbox lifecycle](#sandbox-lifecycle) | `neev.sandboxes.create / list / get / update / pause / resume / delete` | [`create-sandbox.ts`](./examples/create-sandbox.ts) |
| [Templates](#templates) | `neev.templates.list / get` | [`docker.ts`](./examples/docker.ts) |
| [Files](#files) | `sandbox.files` | [`files.ts`](./examples/files.ts) |
| [Commands and processes](#commands-and-processes) | `sandbox.exec`, `sandbox.processes` | [`processes.ts`](./examples/processes.ts) |
| [Terminals and SSH](#terminals-and-ssh) | `sandbox.pty`, `sandbox.ssh()` | [`pty.ts`](./examples/pty.ts) |
| [Preview URLs](#preview-urls) | `sandbox.getUrl`, `sandbox.exposePort` | [`preview-url.ts`](./examples/preview-url.ts) |
| [Snapshots, fork and rollback](#snapshots-fork-and-rollback) | `sandbox.snapshot / fork / rollback` | [`snapshot-fork-rollback.ts`](./examples/snapshot-fork-rollback.ts) |
| [Network egress](#network-egress) | `allowInternet`, `allowEgress`, `egress` | [`update-resize-egress.ts`](./examples/update-resize-egress.ts) |
| [Labels](#labels) | `labels` on create and list | [`labels.ts`](./examples/labels.ts) |
| [Metrics](#metrics) | `sandbox.metrics` | [`sandbox-metrics.ts`](./examples/sandbox-metrics.ts) |
| [Audit trail](#audit-trail) | `sandbox.audit` | [`audit-trail.ts`](./examples/audit-trail.ts) |
| [Code interpreter](#code-interpreter) | `sandbox.code` | [`code-interpreter.ts`](./examples/code-interpreter.ts) |

### Sandbox lifecycle

`create`, `get` and `list` return a `Sandbox` handle. Its lifecycle methods act on that
sandbox, and `get` accepts an id or a name.

```ts
const sandbox = await neev.sandboxes.create({ name: "web" });
await sandbox.waitUntilReady();

await sandbox.pause(); // release compute; files and running processes are kept
await sandbox.resume();
await sandbox.update({ resources: { cpu: 2, memory_gb: 4 } }); // resize in place

const page = await neev.sandboxes.list({ status: "Paused", limit: 50 });
await sandbox.delete();
```

Lifecycle windows stop a sandbox from running forever. Durations are in seconds.

| Option | Meaning |
| --- | --- |
| `idle_timeout_seconds` | Act after this long with no activity |
| `on_idle` | `"pause"` or `"delete"` |
| `max_lifetime_seconds` | Hard limit on total lifetime |

Set them in `lifecycle` at create time, change them with `sandbox.updateTimeout(...)`,
and reset the idle timer with `sandbox.keepalive()`.

See [`create-sandbox.ts`](./examples/create-sandbox.ts) · [`lifecycle-keepalive.ts`](./examples/lifecycle-keepalive.ts) · [reference](./docs/api-reference.md#sandboxes)

### Templates

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
| `sb-ubuntu-26-04-docker` | Docker, Compose and Buildx; run `start-docker` first, and run containers with `--network=host` |
| `sb-ubuntu-26-04-interpreter` | The [code interpreter](#code-interpreter): Python kernels that keep their state |
| `sb-ubuntu-26-04-playwright` | Browser testing: a desktop with Node 24, Playwright and Chromium, headless or headed (`DISPLAY=:1`) |

The catalogue grows over time, so `templates.list()` is the source of truth. To use your
own image instead, pass `image` (a public OCI image with a tag or digest).

Playwright and Chromium come preinstalled on the Playwright template, so a project that
pins the same Playwright version runs its tests with nothing to download:

```ts
const browser = await neev.sandboxes.create({ sandbox_template_id: "sb-ubuntu-26-04-playwright" });
await browser.waitUntilReady();
const run = await browser.exec(["npx", "playwright", "test"], { cwd: "app", timeoutMs: 300_000 });
```

See [`docker.ts`](./examples/docker.ts) · [`byoi-create.ts`](./examples/byoi-create.ts) · [reference](./docs/api-reference.md#templates)

### Files

Paths are relative to the sandbox workspace, or absolute inside it.

```ts
await sandbox.files.write("main.py", "print('hi')");
const text = await sandbox.files.readText("main.py");
const entries = await sandbox.files.list(".", { recursive: true });

await sandbox.files.move("main.py", "app.py");
await sandbox.files.remove("build", { recursive: true });
```

Large writes are sent in resumable chunks automatically. In Node, `uploadFile` and
`downloadFile` move files between local disk and the sandbox without buffering them,
and `files.watch` streams changes as they happen.

See [`files.ts`](./examples/files.ts) · [`upload-download.ts`](./examples/upload-download.ts) · [reference](./docs/api-reference.md#files)

### Commands and processes

`exec` runs a command to completion and returns its output. A non-zero exit code is
returned, not thrown.

```ts
const { stdout, exitCode } = await sandbox.exec(["ls", "-la"]);

// Stream output as it is produced.
for await (const event of sandbox.exec(["npm", "test"], { stream: true })) {
  if (event.type === "stdout") process.stdout.write(event.data);
}
```

For work that should outlive one call, such as a dev server or a watcher, start a
background process instead:

```ts
const proc = await sandbox.processes.start("npm", { args: ["run", "dev"], cwd: "app" });
const page = await proc.logs({ cursor: 0 }); // or follow() to stream
await proc.kill();
```

See [`processes.ts`](./examples/processes.ts) · [`streaming-exec.ts`](./examples/streaming-exec.ts) · [reference](./docs/api-reference.md#commands-and-processes)

### Terminals and SSH

`sandbox.pty` opens an interactive terminal. You send keystrokes and receive output
through a callback.

```ts
const pty = await sandbox.pty.create({ cols: 80, rows: 24, onData: (c) => process.stdout.write(c) });
pty.sendInput("ls -la\n");
const { exitCode } = await pty.wait();
```

`sandbox.ssh()` opens a local port that forwards to the sandbox, so `ssh`, `scp`,
`rsync` and IDE remote development work with no keys to manage. It runs on Node.

```ts
const tunnel = await sandbox.ssh();
console.log(`ssh -p ${tunnel.port} neev@localhost`);
await tunnel.close();
```

In Node, the terminal needs a WebSocket that can send headers. Install
[`ws`](https://www.npmjs.com/package/ws) and pass it as the `webSocket` option (see
[Configuration](#configuration)).

See [`pty.ts`](./examples/pty.ts) · [`ssh-tunnel.ts`](./examples/ssh-tunnel.ts) · [reference](./docs/api-reference.md#terminals-and-ssh)

### Preview URLs

Expose a port and get a public HTTPS URL for it. `getUrl` waits until the URL answers.

```ts
await sandbox.processes.start("python3", { args: ["-m", "http.server", "3000"] });
const url = await sandbox.getUrl({ port: 3000 });
```

Anyone with the URL can open it, so treat it as a secret. Rotate it with
`sandbox.exposePort(3000, { slug })`, and close the port with `sandbox.revokePort(3000)`.

See [`preview-url.ts`](./examples/preview-url.ts) · [reference](./docs/api-reference.md#neevsandboxes)

### Snapshots, fork and rollback

A snapshot captures a sandbox's full state: its files and the memory of its running
processes. Roll the sandbox back to it later, fork the
sandbox's current state into a new one, or restore a snapshot into a new sandbox.

```ts
const snap = await sandbox.snapshot({ name: "checkpoint", waitUntilReady: true });
await sandbox.rollback(snap.id); // back to the snapshot, in place
const copy = await sandbox.fork("my-fork"); // a new sandbox from the current state
const restored = await neev.sandboxes.create({ restore: snap.id }); // a new sandbox from the snapshot
```

See [`snapshot-fork-rollback.ts`](./examples/snapshot-fork-rollback.ts) · [reference](./docs/api-reference.md#snapshots-fork-and-rollback)

### Network egress

A sandbox has no outbound network unless you allow it, apart from any its template
allows (the Docker template allows Docker Hub and GHCR).

```ts
await neev.sandboxes.create({ allowInternet: true });
await neev.sandboxes.create({ allowEgress: ["github.com", "*.npmjs.org"] });

// Edit a running sandbox's allow-list in place.
await sandbox.update({ egress_add: { allow: [{ host: "pypi.org", ports: [443] }] } });
```

For ports and protocols, pass a full `egress` policy instead.

See [`update-resize-egress.ts`](./examples/update-resize-egress.ts) · [reference](./docs/api-reference.md#neevsandboxes)

### Labels

Tag sandboxes at create time and find them again by label.

```ts
await neev.sandboxes.create({ labels: { team: "payments" } });
const { items } = await neev.sandboxes.list({ labels: { team: "payments" } });
```

See [`labels.ts`](./examples/labels.ts) · [reference](./docs/api-reference.md#neevsandboxes)

### Metrics

Read CPU, memory and disk usage over a time window.

```ts
const metrics = await sandbox.metrics({ step: "60s" });
```

See [`sandbox-metrics.ts`](./examples/sandbox-metrics.ts) · [reference](./docs/api-reference.md#neevsandboxes)

### Audit trail

Read what was run inside a sandbox, newest first: commands, terminal and SSH sessions,
and file and process operations. Each event says who made the call and how it ended.
Programs are recorded by name only, never with their arguments.

```ts
const trail = await sandbox.audit({ operation: "exec", status: "failure" });
for (const e of trail.data) {
  console.log(new Date(e.time).toISOString(), e.api.operation, e.actor.user.uid, e.status);
}
```

Filter with `operation`, `status`, `actorType`, `actorUid` or `credentialUid`, and page
back with `cursor: trail.next_cursor`. Events take a few seconds to appear after a call.

See [`audit-trail.ts`](./examples/audit-trail.ts) · [reference](./docs/api-reference.md#neevsandboxes)

### Code interpreter

Sandboxes created from `sb-ubuntu-26-04-interpreter` run Python in kernels that keep
their state between runs.

```ts
const sandbox = await neev.sandboxes.create({ sandbox_template_id: "sb-ubuntu-26-04-interpreter" });

await sandbox.code.run("import pandas as pd\ndf = pd.DataFrame({'x': [1, 2, 3]})");
const run = await sandbox.code.run("int(df.x.sum())");
console.log(run.text); // "6"
```

An exception in your code is returned in `run.error`, not thrown. Use
`sandbox.code.createContext()` for separate kernels with their own state.

See [`code-interpreter.ts`](./examples/code-interpreter.ts) · [reference](./docs/api-reference.md#code-interpreter)

## Agents

An agent is a ready-made coding agent, such as Claude Code, running on its own sandbox.
You choose an agent template, and the SDK manages the agent's life and gives you its
sandbox to work with.

| Capability | API | Example |
| --- | --- | --- |
| [Agent lifecycle](#agent-lifecycle) | `neev.agents.create / list / get / update / pause / resume / delete` | [`create-agent.ts`](./examples/create-agent.ts) |
| [Agent templates](#agent-templates) | `neev.agentTemplates.list / get` | [`create-agent.ts`](./examples/create-agent.ts) |
| [Preview URLs and audit trail](#preview-urls-and-audit-trail) | `agent.getUrl`, `agent.exposePort`, `agent.audit` | [`agent-ports-audit.ts`](./examples/agent-ports-audit.ts) |
| [Working inside the agent's sandbox](#working-inside-the-agents-sandbox) | `agent.sandbox()` | [`create-agent.ts`](./examples/create-agent.ts) |

### Agent lifecycle

`create`, `get` and `list` return an `Agent` handle, and `get` accepts an id or a name.

```ts
const agent = await neev.agents.create({ name: "my-coder", agent_template: "claude-code" });
await agent.waitUntilReady();

await agent.update({ idle_timeout_seconds: 1800 }); // also resources and egress
await agent.pause();
await agent.resume();
await agent.keepalive(); // reset the idle timer
await agent.delete();
```

`agent.rollback(snapshotId)` restores the agent's sandbox to a snapshot in place.

See [`create-agent.ts`](./examples/create-agent.ts) · [reference](./docs/api-reference.md#agents)

### Agent templates

An agent template is the agent you run, such as `claude-code`. Pass its name as
`agent_template` when you create an agent.

```ts
const { items } = await neev.agentTemplates.list();
```

See [`create-agent.ts`](./examples/create-agent.ts) · [reference](./docs/api-reference.md#agent-templates)

### Preview URLs and audit trail

Agents expose ports and keep an audit trail the same way sandboxes do.

```ts
const url = await agent.getUrl({ port: 3000 });
const trail = await agent.audit({ limit: 50 });
```

See [`agent-ports-audit.ts`](./examples/agent-ports-audit.ts) · [reference](./docs/api-reference.md#agents)

### Working inside the agent's sandbox

`agent.sandbox()` returns the agent's sandbox as a `Sandbox` handle, so files, commands
and processes work exactly as they do on any sandbox.

```ts
const sandbox = await agent.sandbox();
await sandbox.files.write("task.md", "# scratch\n");
const { stdout } = await sandbox.exec(["ls"]);
```

See [`create-agent.ts`](./examples/create-agent.ts) · [reference](./docs/api-reference.md#agents)

## Agent tools

`@neevcloud/sdk/agent-tools` gives the agent you build a ready-made set of sandbox tools,
with descriptions and JSON schemas written for a model. Use it with any model API, or
through an adapter for your agent framework.

| Capability | API | Example |
| --- | --- | --- |
| [The tool contract](#the-tool-contract) | `SandboxTools`, `DESCRIPTIONS`, `PARAMETERS`, `FatalGuard` | [`agent-tools.ts`](./examples/agent-tools.ts) |
| [Framework adapters](#framework-adapters) | `toClaude`, `toOpenAIAgents`, `toAiSdk` | [`examples/agents/`](./examples/agents/README.md) |

### The tool contract

```ts
import { DESCRIPTIONS, PARAMETERS, SandboxTools } from "@neevcloud/sdk/agent-tools";

const tools = new SandboxTools(sandbox, { allowProcesses: true });
const specs = tools.names().map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  parameters: PARAMETERS[name],
}));

// For each tool call from the model:
const result = await tools.call(toolCall.name, toolCall.arguments);
```

| Tools | Enabled |
| --- | --- |
| `run_command`, `write_file`, `read_file`, `stat_path`, `move_path`, `delete_path` | Always |
| `expose_port` | `allowPreview: true` |
| `checkpoint`, `rollback` | `allowRollback: true` |
| `start_process`, `read_process_output`, `stop_process`, `list_processes` | `allowProcesses: true` |

Mistakes the model can fix come back as `{ error }`. Authentication, rate-limit, server
and network failures throw. `FatalGuard` turns those into one fixed error for the model,
stops later calls, and rethrows the first failure to you.

See [`agent-tools.ts`](./examples/agent-tools.ts) · [reference](./docs/api-reference.md#agent-tools)

### Framework adapters

Adapters turn the tools into a framework's own tools. Install the framework yourself;
each one is an optional dependency.

| Framework | Import |
| --- | --- |
| Claude Agent SDK | `toClaude` from `@neevcloud/sdk/agent-tools/claude` |
| OpenAI Agents SDK (Node 20+) | `toOpenAIAgents` from `@neevcloud/sdk/agent-tools/openai-agents` |
| Vercel AI SDK | `toAiSdk` from `@neevcloud/sdk/agent-tools/ai-sdk` |

```ts
import { SandboxTools } from "@neevcloud/sdk/agent-tools";
import { toOpenAIAgents } from "@neevcloud/sdk/agent-tools/openai-agents";
import { Agent, run } from "@openai/agents";

const agent = new Agent({ name: "coder", tools: toOpenAIAgents(new SandboxTools(sandbox)) });
const result = await run(agent, prompt);
```

A sandbox failure that the model can't fix stops the run and is rethrown to you.

See [`examples/agents/`](./examples/agents/README.md) · [reference](./docs/api-reference.md#framework-adapters)

### DeepSeek Harness

[`@neevcloud/dsh-sandbox`](https://github.com/NeevCloudAI/dsh-neev-sandbox) runs the
Harness's shell, terminal, files and LSP inside a NeevCloud sandbox:
`dsh plugin add @neevcloud/dsh-sandbox`.

## Errors

Every failure is a `NeevError`. API failures are `APIError` subclasses with the HTTP
status, a machine-readable `code` and a `requestId` for support.

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

| Error | When |
| --- | --- |
| `BadRequestError` | 400: invalid request |
| `AuthenticationError` | 401: missing or invalid API key |
| `PermissionDeniedError` | 403: not allowed |
| `NotFoundError` | 404: no such resource |
| `ConflictError` | 409: conflicting state |
| `RateLimitError` | 429: too many requests |
| `InternalServerError` | 5xx (`ServiceUnavailableError` for 503) |
| `APIConnectionError`, `APITimeoutError` | The request did not complete |

Branch on `err.code` rather than the message text. Network errors, 429 and 5xx are
retried automatically. Calls inside a sandbox, such as `exec` and `files.write`, are not
retried, because running them twice could repeat their effect.

## Configuration

Pass options to `new Neev({ ... })`, or set the matching environment variables. They
apply to every product.

| Option | Environment variable | Default |
| --- | --- | --- |
| `apiKey` | `NEEV_API_KEY` | Required |
| `orgId` | `NEEV_ORG_ID` | Required for most calls |
| `projectId` | `NEEV_PROJECT_ID` | Required for most calls |
| `timeoutMs` | | `60000` |
| `maxRetries` | | `2` |
| `fetch` | | The runtime's `fetch` |
| `webSocket` | | The runtime's `WebSocket` |

Find your organization and project IDs as described in [Organizations and projects](https://docs.ai.neevcloud.com/getting-started/org-and-project#find-your-organization-id-and-project-id).

Every method also accepts `orgId` and `projectId` to override the client's defaults for
one call. In Node, pass a WebSocket for terminals:

```ts
import WebSocket from "ws";

const neev = new Neev({ webSocket: (url, opts) => new WebSocket(url, opts) });
```

For an endpoint the SDK does not wrap yet, `neev.raw.request<T>({ method, path })` sends
a request with the same authentication, retries and errors.

## Examples

Runnable scripts live in [`examples/`](./examples); see its
[README](./examples/README.md) for setup and the full list.

### Sandboxes

| Example | What it shows |
| --- | --- |
| [`create-sandbox.ts`](./examples/create-sandbox.ts) | Create, wait, pause, resume, delete |
| [`files.ts`](./examples/files.ts) | Write, read, list, move and remove files |
| [`upload-download.ts`](./examples/upload-download.ts) | Large uploads with progress, local-disk transfers |
| [`processes.ts`](./examples/processes.ts) | Background processes: start, follow, kill |
| [`streaming-exec.ts`](./examples/streaming-exec.ts) | Live command output |
| [`pty.ts`](./examples/pty.ts) | Interactive terminal |
| [`ssh-tunnel.ts`](./examples/ssh-tunnel.ts) | SSH, scp and rsync through a local port |
| [`preview-url.ts`](./examples/preview-url.ts) | Serve a port at a public URL |
| [`snapshot-fork-rollback.ts`](./examples/snapshot-fork-rollback.ts) | Snapshot, roll back and fork |
| [`audit-trail.ts`](./examples/audit-trail.ts) | Read and filter the audit trail |
| [`code-interpreter.ts`](./examples/code-interpreter.ts) | Python with state kept between runs |
| [`docker.ts`](./examples/docker.ts) | Docker inside a sandbox |

### Agents

| Example | What it shows |
| --- | --- |
| [`create-agent.ts`](./examples/create-agent.ts) | Create and drive an agent |
| [`agent-ports-audit.ts`](./examples/agent-ports-audit.ts) | An agent's preview URL, keepalive and audit trail |

### Agent tools

| Example | What it shows |
| --- | --- |
| [`agent-tools.ts`](./examples/agent-tools.ts) | Sandbox tools for your own agent |
| [`examples/agents/`](./examples/agents/README.md) | The sandbox as a tool in LangChain, Genkit and the Vercel AI SDK |

## Documentation

| Guide | For |
| --- | --- |
| [Getting started](./docs/getting-started.md) | Install, credentials and a first sandbox, step by step |
| [API reference](./docs/api-reference.md) | Every product and method, with snippets |
| [API inventory](./docs/api-inventory.md) | Full signatures, types and errors |
| [Changelog](./CHANGELOG.md) | What changed in each release |
| [NeevCloud documentation](https://docs.ai.neevcloud.com) | Platform guides and concepts |

## Security

Report vulnerabilities as described in [SECURITY.md](./SECURITY.md). Keep your API key out
of source control and logs. Contributions are welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE) © NeevCloud
