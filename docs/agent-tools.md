# Agent tools

`@neevcloud/sdk/agent-tools` gives the agent you build a ready-made set of sandbox tools,
with descriptions and JSON schemas written for a model. Use it with any model API, or
through an adapter for your agent framework. The tool names, descriptions, schemas and
error text are the same in every NeevCloud SDK.

| Capability | API | Example |
| --- | --- | --- |
| [The tool contract](#the-tool-contract) | `SandboxTools`, `DESCRIPTIONS`, `PARAMETERS`, `TITLES` | [`agent-tools.ts`](../examples/agent-tools.ts) |
| [Framework adapters](#framework-adapters) | `toClaude`, `toOpenAIAgents`, `toAiSdk` | [`examples/agents/`](../examples/agents/README.md) |
| [Stopping on fatal errors](#stopping-on-fatal-errors) | `FatalGuard`, `FATAL_ERROR` | [`agent-tools.ts`](../examples/agent-tools.ts) |
| [Lifecycle patterns](#lifecycle-patterns) | `keepalive`, `lifecycle`, `delete` | [`agent-tools.ts`](../examples/agent-tools.ts) |

## The tool contract

Bind the tools to a sandbox, declare them to your model, and pass each tool call the
model makes to `tools.call`.

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

`tools.specs()` returns the same thing in one call, one `{ name, title, description,
parameters, call(args) }` per enabled tool. Opt-in tools stay off unless you enable them:

| Tools | Enabled |
| --- | --- |
| `run_command`, `write_file`, `read_file`, `stat_path`, `move_path`, `delete_path` | Always |
| `expose_port` | `allowPreview: true` |
| `checkpoint`, `rollback` | `allowRollback: true` |
| `start_process`, `read_process_output`, `stop_process`, `list_processes` | `allowProcesses: true` |

Every tool resolves to a plain object for the model to read. A mistake the model can fix,
such as a missing argument, a path that doesn't exist, an unknown or disabled tool, or a
command that times out, comes back as `{ error }`. A non-zero exit from `run_command` is a
result, not an error. `run_command` runs through `sh -lc` with a 60-second default timeout
(`timeout_s`, up to 600), and output over 10 KB is cut in the middle.

See [`agent-tools.ts`](../examples/agent-tools.ts) · [reference](./api-reference.md#the-tool-contract)

## Framework adapters

Adapters turn the tools into a framework's own tools. Install the framework yourself;
each one is an optional dependency.

| Framework | Import |
| --- | --- |
| Claude Agent SDK (with `zod` 4.2 or later) | `toClaude` from `@neevcloud/sdk/agent-tools/claude` |
| OpenAI Agents SDK (Node 20+) | `toOpenAIAgents` from `@neevcloud/sdk/agent-tools/openai-agents` |
| Vercel AI SDK 5, 6 or 7 | `toAiSdk` from `@neevcloud/sdk/agent-tools/ai-sdk` |

**Claude Agent SDK.** The tools run in-process as an MCP server and Claude Code's own
tools are switched off. `watch` yields the run's messages and closes the query when it
ends.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { SandboxTools } from "@neevcloud/sdk/agent-tools";
import { toClaude } from "@neevcloud/sdk/agent-tools/claude";

const claude = toClaude(new SandboxTools(sandbox));
for await (const msg of claude.watch(query({ prompt, options: { ...claude.options(), maxTurns: 12 } }))) {
  if (msg.type === "result" && msg.subtype === "success") console.log(msg.result);
}
```

**OpenAI Agents SDK.**

```ts
import { Agent, run } from "@openai/agents";
import { SandboxTools } from "@neevcloud/sdk/agent-tools";
import { toOpenAIAgents } from "@neevcloud/sdk/agent-tools/openai-agents";

const agent = new Agent({ name: "coder", tools: toOpenAIAgents(new SandboxTools(sandbox)) });
const result = await run(agent, prompt);
```

**Vercel AI SDK.**

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

[`examples/agents/`](../examples/agents/README.md) also wires a sandbox into LangChain and
Genkit as a code-execution tool. For the DeepSeek Harness,
[`@neevcloud/dsh-sandbox`](https://github.com/NeevCloudAI/dsh-neev-sandbox) runs its shell,
terminal, files and LSP inside a NeevCloud sandbox: `dsh plugin add @neevcloud/dsh-sandbox`.

See [`examples/agents/`](../examples/agents/README.md) · [reference](./api-reference.md#framework-adapters)

## Stopping on fatal errors

Authentication, permission, rate-limit, server and network failures throw from
`tools.call`, because no next tool call can fix them. Some frameworks catch a thrown tool
error and hand it to the model, which then retries a call that can't succeed. Each
adapter stops the run instead:

| Adapter | On a fatal failure |
| --- | --- |
| `toClaude` | `watch` stops the run and throws the error |
| `toOpenAIAgents` | The error ends `run` |
| `toAiSdk` | The guard aborts `guard.signal`; `guard.raiseIfFailed()` throws the error |

In your own loop, wrap each call in a `FatalGuard`, one per run. It answers the first
throw with `{ error: FATAL_ERROR }`, aborts `guard.signal`, refuses every later call, and
keeps the error for you:

```ts
import { FatalGuard, SandboxTools } from "@neevcloud/sdk/agent-tools";

const guard = new FatalGuard();
const specs = new SandboxTools(sandbox).specs();

// For each tool call from the model:
const spec = specs.find((s) => s.name === toolCall.name);
const result = spec ? await guard.call(spec, toolCall.arguments) : { error: "unknown tool" };

// After the run, or once guard.signal aborts:
guard.raiseIfFailed();
```

The error's own text never reaches the model, since it can carry request URLs with your
organization and project IDs.

See [`agent-tools.ts`](../examples/agent-tools.ts) · [reference](./api-reference.md#the-tool-contract)

## Lifecycle patterns

The tools act on the sandbox you give them; creating, keeping and cleaning up that
sandbox is up to you.

**One sandbox per run.** Create it before the loop and delete it in `finally`, so a
failed run doesn't leave it running. Set an idle window as a backstop.

```ts
import { SandboxTools } from "@neevcloud/sdk/agent-tools";

const sandbox = await neev.sandboxes.create({
  sandbox_template_id: "sb-ubuntu-26-04-dev",
  lifecycle: { idle_timeout_seconds: 900, on_idle: "delete" },
});
try {
  await sandbox.waitUntilReady();
  await runAgent(new SandboxTools(sandbox));
} finally {
  await sandbox.delete();
}
```

**Keep it alive while the model thinks.** A long model turn makes no sandbox calls, so
call `sandbox.keepalive()` once per turn to reset the idle timer.

**Checkpoint risky work.** With `allowRollback: true` the model can call `checkpoint`
before a risky change and `rollback` if it goes wrong.

**Keep a workspace between sessions.** Pause the sandbox when a session ends instead of
deleting it, and hand it to the tools again next time with `neev.sandboxes.get(name)`. A
paused sandbox wakes on the first tool call where automatic wake-up is enabled; see
[Pause and wake](./sandboxes.md#pause-and-wake).

See [`agent-tools.ts`](../examples/agent-tools.ts) · [`ai-interpreter.ts`](../examples/agents/ai-interpreter.ts) · [reference](./api-reference.md#agent-tools)
