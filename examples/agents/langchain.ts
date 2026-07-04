/**
 * LangChain.js agent with a Neev sandbox as its code-execution tool.
 *
 * The agent reasons over a task, calls a `run_shell` tool to execute commands
 * in a strongly isolated Neev sandbox, and uses the captured output to produce its
 * answer. The model is NeevCloud `gpt-oss-120b`, served over the
 * OpenAI-compatible Neev inference endpoint.
 *
 * Install (peer deps for this example):
 *   npm install @neevcloud/sdk@beta @langchain/core @langchain/openai @langchain/langgraph zod
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agents/langchain.ts
 *
 * NEEV_API_KEY is used for both the sandbox and (by fallback) the model; set
 * NEEV_INFERENCE_API_KEY if your inference key differs.
 */
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { NEEV_INFERENCE_BASE_URL, NEEV_MODEL, neevInferenceApiKey } from "./model.js";
import { SandboxCodeExecutor, formatRunResult } from "./sandbox-tool.js";

async function main(): Promise<void> {
  const executor = new SandboxCodeExecutor();

  // The sandbox's shell, exposed as the agent's code-execution tool. `sh` is
  // present on every catalogue template.
  const runShell = tool(async ({ command }) => formatRunResult(await executor.runShell(command)), {
    name: "run_shell",
    description: "Run a shell command in the Neev sandbox and return its output.",
    schema: z.object({ command: z.string().describe("Shell command to run") }),
  });

  const agent = createReactAgent({
    // NeevCloud gpt-oss-120b over the OpenAI-compatible inference endpoint.
    // A per-request timeout (with one retry) keeps a slow/stalled completion
    // from hanging the run forever.
    llm: new ChatOpenAI({
      model: NEEV_MODEL,
      temperature: 0,
      apiKey: neevInferenceApiKey(),
      timeout: 90_000,
      maxRetries: 1,
      configuration: { baseURL: NEEV_INFERENCE_BASE_URL },
    }),
    tools: [runShell],
  });

  console.error(
    `[agent] LangChain · ${NEEV_MODEL} — running (first sandbox call waits for warmup)…`,
  );
  try {
    const result = await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content:
              "Use the sandbox to compute the SHA-256 hex digest of the exact string " +
              "'neev' (no trailing newline), then report only the 64-character digest.",
          },
        ],
      },
      // A successful run needs only a couple of steps (one tool call, then the
      // answer); the extra headroom tolerates a few retries while a freshly
      // created sandbox's hostname resolves. A low limit also makes a
      // model that loops on tool calls fail fast with the diagnosis below,
      // rather than churning silently through many model calls first.
      { recursionLimit: 16 },
    );
    const final = result.messages.at(-1);
    console.log(final?.content);
  } catch (err) {
    // Hitting the recursion limit here almost always means the model never
    // consumed the tool results: it re-issued the same tool call every turn
    // instead of producing a final answer, so the ReAct loop ran until the
    // step budget was exhausted. That points at the inference endpoint not
    // feeding `role:"tool"` messages back into the model (rather than the
    // sandbox or this example), so surface that diagnosis instead of the raw
    // "recursion limit reached" message.
    if (isRecursionLimitError(err)) {
      throw new Error(
        `Agent hit the step limit without answering: the model kept re-calling the tool instead of using its output. This usually means the inference endpoint is not feeding tool results back to the model — verify tool calling against ${NEEV_INFERENCE_BASE_URL} (a plain chat completion will still work) or point NEEV_MODEL / NEEV_INFERENCE_BASE_URL at a tool-calling-capable deployment.`,
        { cause: err },
      );
    }
    throw err;
  } finally {
    // Always release the sandbox so it stops billing.
    await executor.cleanup();
  }
}

// Reports whether an error is LangGraph's recursion-limit error, raised when the
// agent loops to its `recursionLimit` without reaching a stop condition. Matched
// by error name and message so it does not depend on importing the error class.
function isRecursionLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "GraphRecursionError" || /recursion limit/i.test(err.message);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
