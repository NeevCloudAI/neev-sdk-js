import {
  Agent,
  type FunctionTool,
  RunContext,
  Runner,
  ToolCallError,
  Usage,
  setTracingDisabled,
} from "@openai/agents";
import { describe, expect, it } from "vitest";
import { PARAMETERS } from "../../src/agent-tools.js";
import { toOpenAIAgents } from "../../src/agent-tools/openai-agents.js";
import { AuthenticationError } from "../../src/errors.js";
import { ALL, fakeTools } from "./sandbox.js";

setTracingDisabled(true);

// Calls one built tool the way the runner does, with the model's raw JSON arguments.
const invoke = async (built: FunctionTool[], name: string, raw: string): Promise<string> =>
  (await built.find((t) => t.name === name)?.invoke(new RunContext(), raw)) as string;

// A model that calls read_file once with raw arguments, then answers; keeps every input it was sent.
function scriptedModel(raw: string) {
  const steps = [
    {
      output: [
        {
          type: "function_call",
          callId: "c1",
          name: "read_file",
          arguments: raw,
          status: "completed",
        },
      ],
    },
    {
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "done" }],
        },
      ],
    },
  ];
  const inputs: unknown[] = [];
  return {
    inputs,
    async getResponse(request: { input: unknown }) {
      inputs.push(request.input);
      return { ...steps.shift(), usage: new Usage() };
    },
    async *getStreamedResponse() {},
  };
}

describe("toOpenAIAgents", () => {
  it("builds every enabled tool, in order, with the schema and strict off", () => {
    const { tools } = fakeTools(ALL);
    const built = toOpenAIAgents(tools);
    expect(built.map((t) => t.name)).toEqual(tools.names());
    for (const t of built) {
      expect(t.description).toBe(tools.specs().find((s) => s.name === t.name)?.description);
      expect(t.parameters).toEqual(PARAMETERS[t.name as keyof typeof PARAMETERS]);
      expect(t.parameters).not.toBe(PARAMETERS[t.name as keyof typeof PARAMETERS]);
      expect(t.strict).toBe(false);
    }
  });

  it("returns the tool result as JSON text", async () => {
    const { tools, calls } = fakeTools();
    expect(
      JSON.parse(await invoke(toOpenAIAgents(tools), "read_file", '{"path": "a.txt"}')),
    ).toEqual({
      content: "content",
    });
    expect(calls).toEqual([["read", "a.txt"]]);
  });

  it("returns invalid arguments to the model without a sandbox call", async () => {
    const { tools, calls } = fakeTools();
    const out = JSON.parse(await invoke(toOpenAIAgents(tools), "read_file", '{"file": "x"}'));
    expect(out.error).toMatch(/^invalid arguments for read_file/);
    expect(calls).toEqual([]);
  });

  it("rethrows a fatal call", async () => {
    await expect(
      invoke(toOpenAIAgents(fakeTools().tools), "read_file", '{"path": "boom.txt"}'),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("ends Runner.run with a fatal call's error", async () => {
    const model = scriptedModel('{"path": "boom.txt"}');
    const agent = new Agent({
      name: "a",
      model: model as never,
      tools: toOpenAIAgents(fakeTools().tools),
    });
    // The runner wraps it; the sandbox's own error is kept as its error.
    const err = await new Runner().run(agent, "go").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolCallError);
    expect((err as ToolCallError).error).toBeInstanceOf(AuthenticationError);
    expect(model.inputs).toHaveLength(1);
  });

  it("lets the runner answer arguments that are not JSON", async () => {
    const { tools, calls } = fakeTools();
    const model = scriptedModel("{not json");
    await new Runner().run(
      new Agent({ name: "a", model: model as never, tools: toOpenAIAgents(tools) }),
      "go",
    );
    const sent = model.inputs[1] as Array<{ type: string; output: { text: string } }>;
    expect(sent.find((i) => i.type === "function_call_result")?.output.text).toMatch(
      /parsing tool arguments/,
    );
    expect(calls).toEqual([]);
  });
});
