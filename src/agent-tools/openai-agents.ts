// The NeevCloud sandbox tools as OpenAI Agents SDK function tools.

import { type FunctionTool, tool } from "@openai/agents";
import type { SandboxTools } from "../agent-tools.js";

/** Returns the enabled sandbox tools as function tools; a call that throws ends Runner.run, so no FatalGuard is needed. */
export function toOpenAIAgents(tools: SandboxTools): FunctionTool[] {
  return tools.specs().map((spec) =>
    tool({
      name: spec.name,
      description: spec.description,
      // A copy, since PARAMETERS is frozen and a framework may add to a schema it is given.
      parameters: structuredClone(spec.parameters) as never,
      // Strict schemas cannot express optional fields; call() checks the arguments instead.
      strict: false,
      // The runner answers arguments that are not JSON itself; anything else rethrows out of the run.
      errorFunction: (_ctx, err) => {
        throw err;
      },
      execute: async (args) => JSON.stringify(await spec.call(args)),
    }),
  ) as FunctionTool[];
}
