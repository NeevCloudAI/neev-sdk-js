# Agents

An agent is a ready-made coding agent, such as Claude Code, running on its own sandbox.
You choose an agent template, and the agent comes with its tools installed and the
network access it needs. Every method that takes an agent id also accepts its name.

The sandbox behind an agent is an ordinary sandbox, so the [Sandboxes guide](./sandboxes.md)
applies to it too; this page covers what is specific to agents.

| Capability | API | Example |
| --- | --- | --- |
| [Create and manage agents](#create-and-manage-agents) | `neev.agents.create / list / get / update / pause / resume / delete` | [`create-agent.ts`](../examples/create-agent.ts) |
| [Agent templates](#agent-templates) | `neev.agentTemplates.list / get` | [`create-agent.ts`](../examples/create-agent.ts) |
| [Work inside an agent](#work-inside-an-agent) | `agent.sandbox()` | [`create-agent.ts`](../examples/create-agent.ts) |
| [Network access](#network-access) | `agent.update({ egress_add })` | [`create-agent.ts`](../examples/create-agent.ts) |
| [Preview URLs](#preview-urls) | `agent.getUrl`, `agent.exposePort` | [`agent-ports-audit.ts`](../examples/agent-ports-audit.ts) |
| [Snapshots and fork](#snapshots-and-fork) | `agent.snapshot / snapshots / fork / rollback` | [`agent-snapshot-fork-rollback.ts`](../examples/agent-snapshot-fork-rollback.ts) |
| [Audit trail](#audit-trail) | `agent.audit` | [`agent-ports-audit.ts`](../examples/agent-ports-audit.ts) |

## Create and manage agents

`create`, `get` and `list` return an `Agent` handle. A new agent is `Provisioning` until
`waitUntilReady()` returns.

```ts
const agent = await neev.agents.create({ name: "coder", agent_template: "claude-code" });
await agent.waitUntilReady();

const { items } = await neev.agents.list();
await agent.update({ resources: { cpu: 2, memory_gb: 4 }, idle_timeout_seconds: 1800 });
await agent.keepalive(); // reset the idle timer, such as once per turn
await agent.pause(); // stop paying for compute; files are kept
await agent.resume();
await agent.delete(); // the agent and its sandbox
```

`idle_timeout_seconds` sets the idle window; omit it for the account default, and `0`
means no idle limit (the agent then holds quota until you delete it). `config` on create
overrides the template's defaults. `agent.status` is one of `Provisioning`, `Ready`,
`Pausing`, `Paused`, `Failed` or `Deleting`, and `waitUntilReady()` throws at once on
`Failed` or `Paused`.

A paused agent wakes on use the same way a sandbox does: a call through `agent.sandbox()`
wakes it where automatic wake-up is enabled, and otherwise fails with `RateLimitError`, so
call `agent.resume()` and retry. See [Pause and wake](./sandboxes.md#pause-and-wake) and
[`agent-auto-resume.ts`](../examples/agent-auto-resume.ts).

See [`create-agent.ts`](../examples/create-agent.ts) · [reference](./api-reference.md#neevagents)

## Agent templates

An agent template is the agent you run, such as `claude-code`. Pass its name as
`agent_template` when you create an agent.

```ts
const { items } = await neev.agentTemplates.list();
for (const t of items) console.log(t.name, t.description);
```

The catalogue grows over time, so `agentTemplates.list()` is the source of truth.

See [`create-agent.ts`](../examples/create-agent.ts) · [reference](./api-reference.md#agent-templates)

## Work inside an agent

`agent.sandbox()` returns the agent's sandbox as a `Sandbox` handle, so files, commands
and processes work exactly as they do on any sandbox.

```ts
const sandbox = await agent.sandbox();
await sandbox.files.write("task.md", "# Fix the failing test\n");
const { stdout } = await sandbox.exec(["git", "log", "--oneline", "-5"], { cwd: "repo" });
```

See [Commands and processes](./sandboxes.md#commands-and-processes) and
[Files](./sandboxes.md#files) for everything the handle can do.

See [`create-agent.ts`](../examples/create-agent.ts) · [reference](./api-reference.md#agent-handle)

## Network access

An agent starts with its template's egress rules, which allow what the agent needs, such
as its model API, GitHub and the common package registries.

```ts
await agent.update({ egress_add: { allow: [{ host: "api.example.com", ports: [443] }] } });
await agent.update({ egress_remove: { allow: [{ host: "github.com" }] } });
```

`egress`, `allowInternet` and `allowEgress`, on create or update, replace the template's
rules rather than add to them. To allow one more host, create the agent first and then use
`egress_add`. See [Network egress](./sandboxes.md#network-egress) for host formats.

See [`create-agent.ts`](../examples/create-agent.ts) · [reference](./api-reference.md#neevagents)

## Preview URLs

When the agent builds a web app, expose its port to try it in a browser:

```ts
const url = await agent.getUrl({ port: 3000 });
const ports = await agent.listPorts();
await agent.revokePort(3000);
```

Anyone with the URL can open it without signing in. See
[Preview URLs](./sandboxes.md#preview-urls).

See [`agent-ports-audit.ts`](../examples/agent-ports-audit.ts) · [reference](./api-reference.md#agent-handle)

## Snapshots and fork

Snapshot an agent before a risky change, roll it back in place, or fork it into a new
agent.

```ts
const snap = await agent.snapshot({ name: "before-refactor", waitUntilReady: true });
const { items } = await agent.snapshots();

await agent.rollback(snap.id); // back to the snapshot, in place; same id and name

const copy = await agent.fork("coder-copy"); // a new agent from the current state
await copy.waitUntilReady();
```

`fork` returns a new `Agent` with the source's template and configuration; the source
keeps running. The resource methods `neev.agents.createSnapshot`, `listSnapshots` and
`fork` do the same by id or name. Forking a paused agent fails with `ConflictError`, and one
that is still provisioning with `TooEarlyError`; snapshotting an agent whose sandbox isn't
running fails with `BadRequestError`.

See [`agent-snapshot-fork-rollback.ts`](../examples/agent-snapshot-fork-rollback.ts) · [reference](./api-reference.md#neevagents)

## Audit trail

An agent's audit trail has the same events, filters and paging as a
[sandbox's](./sandboxes.md#audit-trail).

```ts
const trail = await agent.audit({ limit: 50 });
for (const e of trail.data) console.log(e.type_name, e.api?.operation ?? e.process?.name);
```

An agent has no `execution_trace` setting.

See [`agent-ports-audit.ts`](../examples/agent-ports-audit.ts) · [reference](./api-reference.md#audit-trail)
