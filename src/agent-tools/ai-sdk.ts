// The NeevCloud sandbox tools as Vercel AI SDK tools.

import { type JSONSchema7, type Tool, jsonSchema, tool } from "ai";
import { FatalGuard, type SandboxTools } from "../agent-tools.js";

/** Tools for generateText/streamText, and the guard that stops the run on a fatal call. */
export interface AiSdkTools {
  tools: Record<string, Tool>;
  guard: FatalGuard;
}

/**
 * Returns the enabled sandbox tools; pass `abortSignal: guard.signal` and call `guard.raiseIfFailed()` after the run, also when it throws.
 * @example
 * const { tools, guard } = toAiSdk(new SandboxTools(sandbox));
 * try {
 *   await generateText({ model, tools, stopWhen: stepCountIs(12), abortSignal: guard.signal, prompt });
 * } finally {
 *   guard.raiseIfFailed();
 * }
 */
export function toAiSdk(tools: SandboxTools): AiSdkTools {
  const guard = new FatalGuard();
  const entries = tools.specs().map((spec) => [
    spec.name,
    tool({
      description: spec.description,
      // jsonSchema() does not validate; call() returns a bad call to the model as an error result.
      inputSchema: jsonSchema(structuredClone(spec.parameters) as JSONSchema7),
      execute: (args: unknown) => guard.call(spec, args),
    }),
  ]);
  return { tools: Object.fromEntries(entries), guard };
}
