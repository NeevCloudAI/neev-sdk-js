import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { describe, expect, it } from "vitest";
import { FATAL_ERROR, PARAMETERS } from "../../src/agent-tools.js";
import { toAiSdk } from "../../src/agent-tools/ai-sdk.js";
import { AuthenticationError } from "../../src/errors.js";
import { ALL, fakeTools } from "./sandbox.js";

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

const toolStep = (toolName: string, input: unknown) => ({
  content: [
    { type: "tool-call" as const, toolCallId: "call-1", toolName, input: JSON.stringify(input) },
  ],
  finishReason: "tool-calls" as const,
  usage,
  warnings: [],
});

const textStep = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: "stop" as const,
  usage,
  warnings: [],
});

// A model that plays steps in order and, like a real provider, rejects once the run is aborted.
function fakeModel(steps: Array<ReturnType<typeof toolStep> | ReturnType<typeof textStep>>) {
  return new MockLanguageModelV2({
    doGenerate: async (options) => {
      if (options.abortSignal?.aborted) throw options.abortSignal.reason;
      return steps.shift() as never;
    },
  });
}

// Runs the documented pattern: abort on the guard's signal, then raiseIfFailed.
async function run(tools: ReturnType<typeof fakeTools>["tools"], model: MockLanguageModelV2) {
  const { tools: aiTools, guard } = toAiSdk(tools);
  try {
    const { text } = await generateText({
      model,
      tools: aiTools,
      stopWhen: stepCountIs(5),
      abortSignal: guard.signal,
      prompt: "go",
    });
    return text;
  } finally {
    guard.raiseIfFailed();
  }
}

// The tool output the model saw on its second step.
const toolOutput = (model: MockLanguageModelV2) =>
  (
    model.doGenerateCalls[1]?.prompt.find((m) => m.role === "tool")?.content[0] as {
      output: unknown;
    }
  ).output;

describe("toAiSdk", () => {
  it("builds every enabled tool, in order, with the schema", () => {
    const { tools } = fakeTools(ALL);
    const built = toAiSdk(tools).tools;
    expect(Object.keys(built)).toEqual(tools.names());
    for (const spec of tools.specs()) {
      expect(built[spec.name]?.description).toBe(spec.description);
      expect((built[spec.name]?.inputSchema as { jsonSchema: unknown }).jsonSchema).toEqual(
        PARAMETERS[spec.name],
      );
    }
  });

  it("hands a tool result to the model and finishes the run", async () => {
    const { tools, calls } = fakeTools();
    const model = fakeModel([toolStep("read_file", { path: "a.txt" }), textStep("read it")]);
    expect(await run(tools, model)).toBe("read it");
    expect(toolOutput(model)).toEqual({ type: "json", value: { content: "content" } });
    expect(calls).toEqual([["read", "a.txt"]]);
  });

  it("aborts the run on a fatal call and rethrows its error", async () => {
    const model = fakeModel([toolStep("read_file", { path: "boom.txt" }), textStep("never")]);
    await expect(run(fakeTools().tools, model)).rejects.toBeInstanceOf(AuthenticationError);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("answers the fatal call with the fixed result", async () => {
    const { tools, guard } = toAiSdk(fakeTools().tools);
    const execute = tools.read_file?.execute as (args: unknown, opts: unknown) => Promise<unknown>;
    expect(await execute({ path: "boom.txt" }, { toolCallId: "c", messages: [] })).toEqual({
      error: FATAL_ERROR,
    });
    expect(guard.signal.aborted).toBe(true);
  });
});
