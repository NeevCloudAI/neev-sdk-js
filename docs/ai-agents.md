# Use the SDK from an AI agent

This page lets a coding agent, such as Claude Code, Cursor or Codex, write code against
`@neevcloud/sdk` without guessing. The first part is for you: prompts to paste into your
agent. The rest is for the agent: the checks, rules and recipes it should follow.

- [Prompts to paste](#prompts-to-paste)
- [For agents: before the first call](#for-agents-before-the-first-call)
- [For agents: rules](#for-agents-rules)
- [Sandboxes](#sandboxes)
- [Agents](#agents)
- [Agent tools](#agent-tools)

## Prompts to paste

Each prompt points your agent at this page, so it picks up the rules below. Set
`NEEV_API_KEY`, `NEEV_ORG_ID` and `NEEV_PROJECT_ID` in the agent's environment first;
never paste a key into the chat.

**General setup**

```md
Read https://raw.githubusercontent.com/NeevCloudAI/neev-sdk-js/main/docs/ai-agents.md and
follow it to use NeevCloud through @neevcloud/sdk. Run its pre-flight checks, tell me
which organization and project you will use, and wait for my go-ahead before creating
anything.
```

**Run tests in a sandbox**

```md
Read https://raw.githubusercontent.com/NeevCloudAI/neev-sdk-js/main/docs/ai-agents.md.
Write a TypeScript script with @neevcloud/sdk that creates a sandbox, uploads this
repository's source, installs its dependencies and runs its test suite there, prints the
results, and deletes the sandbox even if a step fails.
```

**Preview a web app**

```md
Read https://raw.githubusercontent.com/NeevCloudAI/neev-sdk-js/main/docs/ai-agents.md.
Write a script that runs this app in a NeevCloud sandbox, starts its dev server as a
background process, and prints the preview URL. Keep the sandbox running until I say so.
```

**Give my agent a sandbox**

```md
Read https://raw.githubusercontent.com/NeevCloudAI/neev-sdk-js/main/docs/ai-agents.md.
Add NeevCloud sandbox tools to the agent in this repository with
@neevcloud/sdk/agent-tools, using the adapter for the framework it already uses. Create one
sandbox per run and delete it when the run ends.
```

If your agent supports MCP, the
[Sandbox MCP server](https://docs.ai.neevcloud.com/agentic-studio/Sandbox/sandbox-mcp-server)
gives it sandbox tools directly, without writing code.

---

## For agents: before the first call

Run these checks in order. Stop and ask the user only when a check fails.

1. **Installed?** Check that `@neevcloud/sdk` is in the project's `package.json`. If it
   isn't, ask before adding it, then install it with the project's package manager, such
   as `npm install @neevcloud/sdk`. It needs Node 18 or later, Bun, Deno or an edge
   runtime with a global `fetch`.
2. **Credentials?** Check that `NEEV_API_KEY` is set, without printing it. If it isn't,
   ask the user to set it. Never ask them to paste the key into the chat, and never write
   it into source code.
3. **Project?** Check `NEEV_ORG_ID` and `NEEV_PROJECT_ID`. If either is missing, ask the
   user which organization and project to use;
   [Organizations and projects](https://docs.ai.neevcloud.com/getting-started/org-and-project#find-your-organization-id-and-project-id)
   shows how to find the IDs. Tell the user which project you will use.
4. **Smoke test.** Run a script that calls `await new Neev().templates.list()`. An
   `AuthenticationError` means the key is wrong; ask the user to check it.

## For agents: rules

1. **Await everything.** Every method returns a promise.
2. **Clean up in `finally`.** Delete the sandboxes and agents you create when the task is
   done, even when a step fails, unless the user wants them kept. Tell the user what is
   still running.
3. **Name what you create.** Use a short, unique name such as `tests-4821`, and look it up
   later with `neev.sandboxes.get(name)`.
4. **Confirm before destroying.** Ask the user before deleting or rolling back anything you
   didn't create in this task.
5. **Read results, not exceptions.** `exec` returns a non-zero `exitCode` instead of
   throwing, and `code.run` returns `error` instead of throwing. Check them.
6. **Branch on error classes and `err.code`,** never on message text. See
   [Errors](./errors.md).
7. **Don't retry calls inside a sandbox blindly.** `exec` and file writes are not retried
   for you, because a retry could run them twice. Retry only reads and idempotent commands.
8. **Open only the egress you need.** Prefer `allowEgress: ["host"]` over
   `allowInternet: true`, and tell the user which hosts you opened.
9. **Preview URLs are public.** Anyone with one can open it. Give it only to the user, and
   close it with `revokePort` when done.
10. **Check the reference before guessing a name.** Every method and option is in the
    [API reference](./api-reference.md); don't invent one.

## Sandboxes

A sandbox is an isolated Linux machine. Paths are relative to its workspace, or absolute
inside it, and it can reach no outside host unless its template or you open one.

```ts
import { Neev } from "@neevcloud/sdk";

const neev = new Neev();
const sandbox = await neev.sandboxes.create({
  name: "tests-4821",
  sandbox_template_id: "sb-ubuntu-26-04-dev",
  allowEgress: ["registry.npmjs.org"],
});
try {
  await sandbox.waitUntilReady();
  await sandbox.files.write("app/package.json", packageJson);
  const run = await sandbox.exec(["sh", "-c", "npm ci && npm test"], { cwd: "app", timeoutMs: 600_000 });
  console.log(run.exitCode, run.stdout, run.stderr);
} finally {
  await sandbox.delete();
}
```

| Template | Use it for |
| --- | --- |
| `sb-ubuntu-26-04-dev` | General development: git, gh, Python 3, Node 24 |
| `sb-ubuntu-26-04-docker` | Docker; run containers with `--network=host` |
| `sb-ubuntu-26-04-interpreter` | `sandbox.code.run()`: Python kernels that keep state between runs |
| `sb-ubuntu-26-04-playwright` | Browser automation with Playwright and Chromium |

**Commands run without a shell.** Use `["sh", "-c", "..."]` for pipes, `&&`, redirects
and environment variables.

**Long-running work.** A command that prints nothing for about two minutes can be cut
off. Start servers and long jobs with `sandbox.processes.start(...)`, then read their
output with `proc.logs()` or `proc.follow()`.

**Preview a web app.** Start the server in the background, bound to `0.0.0.0`, then
`await sandbox.getUrl({ port: 3000 })`. It waits until the URL answers.

**Checkpoints.** `await sandbox.snapshot({ name: "before", waitUntilReady: true })` before
a risky change, and `await sandbox.rollback(snap.id)` if it goes wrong.

**Paused sandboxes.** A paused sandbox wakes on the next `exec` or file call where the
platform allows it. If that call throws `RateLimitError`, call `await sandbox.refresh()`;
if `sandbox.phase` is `Paused`, call `sandbox.resume()` and retry; `waitUntilReady()` throws on a paused
sandbox. See [Pause and wake](./sandboxes.md#pause-and-wake).

**Network access.** `await sandbox.update({ egress_add: { allow: [{ host: "pypi.org" }] } })`
adds a host; it fails on a sandbox with no allow-list yet, so create it with
`allowEgress` first. A host is a domain, `*.domain`, or an IP address or CIDR range, never a
URL.

More in the [Sandboxes guide](./sandboxes.md).

## Agents

An agent is a ready-made coding agent, such as Claude Code, on its own sandbox.

```ts
const agent = await neev.agents.create({ name: "reviewer", agent_template: "claude-code" });
await agent.waitUntilReady();
const sandbox = await agent.sandbox();
const { stdout } = await sandbox.exec(["git", "--version"]);
```

- List the available templates with `neev.agentTemplates.list()`.
- The template already allows the hosts the agent needs. Don't pass `egress`,
  `allowInternet` or `allowEgress` to `agents.create`, since that replaces the list; add a
  host afterwards with `agent.update({ egress_add: { allow: [{ host }] } })`.
- `TooEarlyError` means the agent is still provisioning: wait and retry.
- Snapshot, roll back and fork with `agent.snapshot()`, `agent.rollback(id)` and
  `agent.fork(name)`.
- The coding agent isn't signed in to its model provider yet, so don't run it
  non-interactively until the user has signed in.

More in the [Agents guide](./agents.md).

## Agent tools

To give a model you call yourself a sandbox, use `@neevcloud/sdk/agent-tools` instead of
writing your own tool definitions.

```ts
import { SandboxTools } from "@neevcloud/sdk/agent-tools";

const tools = new SandboxTools(sandbox, { allowProcesses: true });
for (const spec of tools.specs()) {
  // declare spec.name, spec.description and spec.parameters to the model
}
const result = await tools.call(toolCall.name, toolCall.arguments);
```

- Use the adapter for the framework the project already uses: `toClaude`,
  `toOpenAIAgents` or `toAiSdk`.
- Results the model can act on come back as `{ error }`; authentication, rate-limit,
  server and network failures throw. Stop the run on a throw, with `FatalGuard` in your
  own loop.
- Enable only the opt-in tools the task needs: `allowPreview`, `allowRollback`,
  `allowProcesses`.

More in the [Agent tools guide](./agent-tools.md).
