# Agent framework examples

These examples wire a **Neev sandbox** into popular agentic frameworks as a
secure code-execution tool. Each agent reasons over a task, runs Python or shell
inside a gVisor-isolated Neev sandbox, and uses the captured output to answer.

All three drive the **same NeevCloud model — `gpt-oss-120b`** — over the
OpenAI-compatible Neev inference endpoint, and share two helpers:

- [`sandbox-tool.ts`](./sandbox-tool.ts) — a `SandboxCodeExecutor` that
  provisions one sandbox, exposes `runPython` / `runShell`, and tears it down.
- [`model.ts`](./model.ts) — the shared model config (endpoint + `gpt-oss-120b`).

So each example file holds only the framework-specific wiring.

| Example | Framework | Model |
| ------- | --------- | ----- |
| [`langchain.ts`](./langchain.ts) | LangChain.js (LangGraph ReAct agent) | NeevCloud `gpt-oss-120b` |
| [`genkit.ts`](./genkit.ts) | Google Genkit | NeevCloud `gpt-oss-120b` |
| [`vercel-ai.ts`](./vercel-ai.ts) | Vercel AI SDK | NeevCloud `gpt-oss-120b` |
| [`ai-interpreter.ts`](./ai-interpreter.ts) | none (hand-rolled loop) | NeevCloud `gpt-oss-120b` |

**[`ai-interpreter.ts`](./ai-interpreter.ts)** is the highlight: the model writes
shell, it runs in the sandbox, and its output **streams to your terminal live**
(via `sandbox.exec(cmd, { stream: true })`) as it executes — the "AI writes code,
watch it run safely" demo. No framework, no extra deps (just `@neevcloud/sdk` + global `fetch`):

```sh
npx tsx examples/agents/ai-interpreter.ts
```

## Setup

First do the one-time setup in [`../README.md`](../README.md) (`pnpm install &&
pnpm build` — `@neevcloud/sdk` then resolves from the local build, no install needed).
One NeevCloud API key covers both the sandbox and the model:

```sh
export NEEV_API_KEY=...        # sandbox + model (inference)
export NEEV_ORG_ID=...
export NEEV_PROJECT_ID=...
```

That's the whole setup. Defaults applied for you:

| Setting | Default | Override |
| ------- | ------- | -------- |
| Model | `gpt-oss-120b` | — |
| Inference endpoint | `https://inference.ai.neevcloud.com/v1` | `NEEV_INFERENCE_BASE_URL` |
| Inference key | `NEEV_API_KEY` | `NEEV_INFERENCE_API_KEY` |
| Region | `as-south-1` | `new SandboxCodeExecutor({ region })` |
| Template | `sb-ubuntu-26-04-minimal` | `new SandboxCodeExecutor({ templateId })` |

**Templates and binaries.** Discover templates with `neev.templates.list()`
(e.g. `sb-debian-12-minimal`, `sb-ubuntu-26-04-minimal`). The minimal images are
deliberately small: they ship `sh` but **not** `bash`, and **not** `python3`. So
`runShell` works everywhere, while `runPython` needs a python-capable template
(pass one to `new SandboxCodeExecutor({ templateId })`, or `apt-get install -y
python3` first via `runShell`). Sandbox file paths are **workspace-relative**.

## Run

`@neevcloud/sdk` resolves from the local build (after `pnpm build`); each framework
example needs only its own peer deps installed:

```sh
# AI code-interpreter — no extra deps
npx tsx examples/agents/ai-interpreter.ts

# LangChain
pnpm add -D @langchain/core @langchain/openai @langchain/langgraph zod
npx tsx examples/agents/langchain.ts

# Google Genkit
pnpm add -D genkit @genkit-ai/compat-oai
npx tsx examples/agents/genkit.ts

# Vercel AI SDK (v4 API)
pnpm add -D ai@^4 @ai-sdk/openai@^1 zod
npx tsx examples/agents/vercel-ai.ts
```

## Verify

Each example asks the agent to compute the SHA-256 of the string `neev` inside
the sandbox and report the digest. A successful run prints:

```
3fb3a134aebfd0bf072b02b4096612a39e201593853091c52510d37adc3d98de
```

(`printf 'neev' | sha256sum`). If you see that digest, the full loop worked:
model tool-call → code executed in the sandbox → result returned → sandbox
deleted. Right after the sandbox reaches Ready, its hostname can take
a few seconds to resolve, so the first tool call may need a moment — the agent
loop simply waits and retries on its own.

## What this demonstrates

- **Lifecycle** — `sandboxes.create` from a catalogue template; automatic
  cleanup with `sandbox.delete()`.
- **Runtime** — `sandbox.exec` runs the agent's shell commands with output
  buffered back to it; `sandbox.files.write` (used by the executor's `runPython`)
  stages files on python-capable templates. The handle resolves the sandbox's
  `connect_url` and waits for Ready on first use.
- **Isolation** — every agent's generated code runs in a gVisor (`runsc`)
  sandbox, not on the host.
