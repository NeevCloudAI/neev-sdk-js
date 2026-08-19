# Examples

Runnable examples for `@neevcloud/sdk`. Run them from this repository against the
local build — `import "@neevcloud/sdk"` resolves automatically (Node package
self-referencing), so there is no install or link step. (To use the published
package in your own project instead, `npm install @neevcloud/sdk@beta`.)

## Quick setup (once)

```sh
# from the repo root
pnpm install
pnpm build            # builds dist/ — examples import "@neevcloud/sdk" and resolve to it

# sandbox credentials
export NEEV_API_KEY=...        # your sandbox API key
export NEEV_ORG_ID=...
export NEEV_PROJECT_ID=...
```

By default the examples use your account's defaults; a few (`parallel-fanout`,
`sandbox-metrics`, and the agent examples) pin a specific template they need.

> Re-run `pnpm build` whenever you change SDK source.

## Examples — no model needed (pure SDK)

| File | What it shows | Run |
|------|---------------|-----|
| [`create-sandbox.ts`](./create-sandbox.ts) | Lifecycle: create → wait for Ready → metrics → resize → pause → delete | `npx tsx examples/create-sandbox.ts` |
| [`create-agent.ts`](./create-agent.ts) | Agent lifecycle: create from a template → wait for Ready → drive its backing sandbox → update → pause → delete | `npx tsx examples/create-agent.ts` |
| [`snapshot-fork-restore.ts`](./snapshot-fork-restore.ts) | Snapshot a sandbox → fork a new one from it → restore the original in place | `npx tsx examples/snapshot-fork-restore.ts` |
| [`streaming-exec.ts`](./streaming-exec.ts) | `sandbox.exec(cmd, { stream: true })` — output streamed line-by-line as it is produced | `npx tsx examples/streaming-exec.ts` |
| [`files.ts`](./files.ts) | `sandbox.files` — write, read, stat/exists, mkdir, move, list, remove, and a live `watch` of changes | `npx tsx examples/files.ts` |
| [`parallel-fanout.ts`](./parallel-fanout.ts) | Several isolated sandboxes run a map/reduce concurrently; reads `metrics()` | `npx tsx examples/parallel-fanout.ts` |
| [`sandbox-metrics.ts`](./sandbox-metrics.ts) | `sandbox.metrics()` polled under CPU load | `npx tsx examples/sandbox-metrics.ts` |
| [`processes.ts`](./processes.ts) | `sandbox.processes` — start a detached process, follow/poll its output, list, kill, wait | `npx tsx examples/processes.ts` |
| [`process-pool.ts`](./process-pool.ts) | Manage several detached processes: start a pool, `list()`/`status()`, then `killAll()` | `npx tsx examples/process-pool.ts` |
| [`pty.ts`](./pty.ts) | `sandbox.pty` — interactive terminal over a WebSocket (needs `pnpm add -D ws @types/ws`) | `npx tsx examples/pty.ts` |
| [`preview-url.ts`](./preview-url.ts) | `sandbox.getUrl({ port })` — serve on a port, get its preview URL, list and revoke ports | `npx tsx examples/preview-url.ts` |
| [`ssh-tunnel.ts`](./ssh-tunnel.ts) | `sandbox.ssh()` over a BYOI image — exec, `rsync` upload, and `ssh -L` port-forward through one tunnel (needs `pnpm add -D ws`) | `npx tsx examples/ssh-tunnel.ts` |

## Examples — with an AI model

These drive NeevCloud `gpt-oss-120b` over the OpenAI-compatible inference
endpoint, so add an inference key (falls back to `NEEV_API_KEY` if your sandbox
and inference keys are the same):

```sh
export NEEV_INFERENCE_API_KEY=...   # inference key
# inference endpoint defaults to https://inference.ai.neevcloud.com/v1
```

| File | Extra install | Run |
|------|---------------|-----|
| [`agents/ai-interpreter.ts`](./agents/ai-interpreter.ts) | none (only `@neevcloud/sdk` + `fetch`) | `npx tsx examples/agents/ai-interpreter.ts` |
| [`agents/langchain.ts`](./agents/langchain.ts) | `pnpm add -D @langchain/core @langchain/openai @langchain/langgraph zod` | `npx tsx examples/agents/langchain.ts` |
| [`agents/vercel-ai.ts`](./agents/vercel-ai.ts) | `pnpm add -D ai@^4 @ai-sdk/openai@^1 zod` | `npx tsx examples/agents/vercel-ai.ts` |
| [`agents/genkit.ts`](./agents/genkit.ts) | `pnpm add -D genkit @genkit-ai/compat-oai` | `npx tsx examples/agents/genkit.ts` |

`ai-interpreter.ts` is the highlight: the model writes shell, it runs in the
sandbox, and its output streams to your terminal live. See
[`agents/README.md`](./agents/README.md) for framework-by-framework detail.

> The `pnpm add -D` installs are just to run the examples in your working copy —
> they don't need to be committed.

## Step-by-step: run every example

Do the [Quick setup](#quick-setup-once) once, then run each in order. Each
example provisions a real sandbox, so the project needs available credits
(`create` returns `failed to validate funds` when they're exhausted).

**1. Lifecycle**
```sh
npx tsx examples/create-sandbox.ts
```
→ `created … (phase: Pending)` → `ready at https://….sandboxes.<region>…` → `metric series: …` → `paused …` → `deleted`.

**1b. Snapshot, fork & restore**
```sh
npx tsx examples/snapshot-fork-restore.ts
```
→ `source … ready` → `snapshot … ready` → `forked … carries: captured-at-snapshot` → `restored …` → `cleaned up`.

**2. Streaming exec**
```sh
npx tsx examples/streaming-exec.ts
```
→ `line 1 … line 5`, each ~1s apart (the `+Nms` timestamps climb), then `exit 0`.

**2b. Filesystem operations**
```sh
npx tsx examples/files.ts
```
→ a live `change: create notes/todo.md` as it writes → `read back: …` → `stat → file, N bytes, rw-r--r--` → `moved …` → a listing of the workspace → `change: remove …` events → `deleted`.

**3. Parallel fan-out + metrics**
```sh
npx tsx examples/parallel-fanout.ts
```
→ three shard sums → `sum(1..3000) across 3 sandboxes = 4501500`.

**4. Metrics under load**
```sh
npx tsx examples/sandbox-metrics.ts
```
→ per-burst readouts; `disk_usage_bytes` carries real points (`cpu`/`memory` depend on the environment's metrics pipeline).

**5. Long-running processes**
```sh
npx tsx examples/processes.ts
```
→ `started proc_…` → a few live `stdout: tick N` lines (via `follow`) → `polled N entries …` → `tracked processes: …` → `kill signalled=true` → `final state=exited exitCode=…`.

**6. Process pool**
```sh
npx tsx examples/process-pool.ts
```
→ `started 3 workers: …` → `list → …(running)…` → `worker 0 status: state=running …` → `killAll signalled 3 process(es)` → each `worker … → state=exited`.

The remaining examples need an AI model — set `NEEV_INFERENCE_API_KEY` (see above).

**7. AI code-interpreter** (no extra deps) — the highlight
```sh
npx tsx examples/agents/ai-interpreter.ts
```
→ a step-by-step transcript: model call (+token usage) → `run_shell` → output streaming live → `✅ final answer`.

**8. LangChain**
```sh
pnpm add -D @langchain/core @langchain/openai @langchain/langgraph zod
npx tsx examples/agents/langchain.ts
```
→ `3fb3a134aebfd0bf072b02b4096612a39e201593853091c52510d37adc3d98de` (SHA-256 of `neev`).

**9. Vercel AI SDK**
```sh
pnpm add -D ai@^4 @ai-sdk/openai@^1 zod
npx tsx examples/agents/vercel-ai.ts
```
→ same digest, via the Vercel AI SDK tool loop.

**10. Genkit**
```sh
pnpm add -D genkit @genkit-ai/compat-oai
npx tsx examples/agents/genkit.ts
```
→ same digest, via Genkit + `@genkit-ai/compat-oai`.

## Environment reference

| Variable | Used by | Default |
|----------|---------|---------|
| `NEEV_API_KEY` | all | — (required) |
| `NEEV_ORG_ID` | all | — (required) |
| `NEEV_PROJECT_ID` | all | — (required) |
| `NEEV_AGENT_TEMPLATE` | `create-agent.ts` | `claude-code` |
| `NEEV_INFERENCE_API_KEY` | model examples | falls back to `NEEV_API_KEY` |
| `NEEV_INFERENCE_BASE_URL` | model examples | production inference endpoint |

## Notes

- Sandbox file paths are **workspace-relative** — the sandbox rejects absolute paths.
- The standard templates ship `sh` only (no `bash`, no `python3`); `sh -c` works
  on every template. `runPython` needs a python-capable template.
- Progress/transcript output goes to **stderr**; an example's result goes to **stdout**.
