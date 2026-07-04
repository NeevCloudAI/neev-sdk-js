/**
 * Vercel AI SDK agent with a Neev sandbox as its code-execution tool.
 *
 * `generateText` runs a multi-step tool-calling loop: the model issues shell
 * commands via the `runShell` tool, which executes them in a strongly isolated
 * Neev sandbox, and the model uses the output to finish the task. The model is
 * NeevCloud `gpt-oss-120b` over the OpenAI-compatible Neev inference endpoint.
 *
 * Install (peer deps for this example):
 *   npm install @neevcloud/sdk@beta ai @ai-sdk/openai zod
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agents/vercel-ai.ts
 *
 * NEEV_API_KEY is used for both the sandbox and (by fallback) the model; set
 * NEEV_INFERENCE_API_KEY if your inference key differs.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";
import { NEEV_INFERENCE_BASE_URL, NEEV_MODEL, neevInferenceApiKey } from "./model.js";
import { SandboxCodeExecutor, formatRunResult } from "./sandbox-tool.js";

async function main(): Promise<void> {
  const executor = new SandboxCodeExecutor();

  // NeevCloud gpt-oss-120b over the OpenAI-compatible inference endpoint.
  const neev = createOpenAI({
    baseURL: NEEV_INFERENCE_BASE_URL,
    apiKey: neevInferenceApiKey(),
  });

  console.error(`[agent] Vercel AI SDK · ${NEEV_MODEL} — running…`);
  try {
    const { text } = await generateText({
      model: neev(NEEV_MODEL),
      // Allow several tool-call rounds so the model can run code then read output.
      maxSteps: 6,
      tools: {
        // The sandbox's shell, exposed as the code-execution tool.
        runShell: tool({
          description: "Run a shell command in the Neev sandbox and return its output.",
          parameters: z.object({ command: z.string().describe("Shell command to run") }),
          execute: async ({ command }) => formatRunResult(await executor.runShell(command)),
        }),
      },
      prompt:
        "Use the sandbox to compute the SHA-256 hex digest of the exact string " +
        "'neev' (no trailing newline), then report only the 64-character digest.",
    });
    console.log(text);
  } finally {
    // Always release the sandbox so it stops billing.
    await executor.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
