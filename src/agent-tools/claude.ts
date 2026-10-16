// The NeevCloud sandbox tools as an in-process MCP server for the Claude Agent SDK.

import {
  type AnyZodRawShape,
  type Options,
  type SDKMessage,
  createSdkMcpServer,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { FATAL_RESULT, FatalGuard, type SandboxTools } from "../agent-tools.js";
import { NeevError } from "../errors.js";

const PREFIX = "mcp__neev__";

/** The query() options that give Claude the sandbox tools and nothing else. */
export type ClaudeOptions = Required<
  Pick<
    Options,
    | "tools"
    | "mcpServers"
    | "strictMcpConfig"
    | "allowedTools"
    | "settingSources"
    | "permissionMode"
  >
>;

/** A running query, as query() returns it. */
export type ClaudeQuery = AsyncIterable<SDKMessage> & { close(): void };

/** The sandbox tools for one Claude Agent SDK run. */
export interface ClaudeTools {
  /** Spread into query()'s options; builds a fresh MCP server each time. */
  options(): ClaudeOptions;
  /** Yields the query's messages, stops and throws on a fatal call or a host tool, and always closes the query. */
  watch(query: ClaudeQuery): AsyncGenerator<SDKMessage, void>;
  guard: FatalGuard;
}

/**
 * Returns the enabled sandbox tools for one Claude Agent SDK run.
 * @example
 * const claude = toClaude(new SandboxTools(sandbox));
 * for await (const msg of claude.watch(query({ prompt, options: { ...claude.options(), maxTurns: 12 } }))) {
 *   if (msg.type === "result") console.log(msg.result);
 * }
 */
export function toClaude(tools: SandboxTools): ClaudeTools {
  // The zod peer range also admits zod 3 for AI SDK users; only this adapter needs fromJSONSchema.
  if (typeof z.fromJSONSchema !== "function")
    throw new NeevError("toClaude needs zod 4.2 or later.");
  const guard = new FatalGuard();
  const specs = tools.specs();
  return {
    guard,
    options() {
      const defs = specs.map((spec) =>
        // additionalProperties: false in the schema makes the SDK return unknown arguments to Claude.
        tool(
          spec.name,
          spec.description,
          z.fromJSONSchema(structuredClone(spec.parameters)) as unknown as AnyZodRawShape,
          async (args) => {
            const result = await guard.call(spec, args);
            const content = [{ type: "text" as const, text: JSON.stringify(result) }];
            return result === FATAL_RESULT ? { content, isError: true } : { content };
          },
          { annotations: { title: spec.title } },
        ),
      );
      return {
        // Claude Code's built-in tools act on the machine running the agent, so none are offered.
        tools: [],
        mcpServers: { neev: createSdkMcpServer({ name: "neev", version: "1.0.0", tools: defs }) },
        strictMcpConfig: true,
        allowedTools: specs.map((spec) => `${PREFIX}${spec.name}`),
        // The user's own Claude Code settings and hooks stay out of the run.
        settingSources: [],
        // Anything not in allowedTools is denied rather than left to a permission prompt.
        permissionMode: "dontAsk",
      };
    },
    async *watch(query) {
      try {
        for await (const msg of query) {
          if (guard.failed) break;
          if (msg.type === "assistant") {
            const stray = msg.message.content
              .filter((block) => block.type === "tool_use" && !block.name.startsWith(PREFIX))
              .map((block) => (block as { name: string }).name);
            if (stray.length) throw new Error(`host tools were used: ${stray.join(", ")}`);
          }
          yield msg;
        }
      } finally {
        // Ends the CLI subprocess whether the loop finished, stopped or threw.
        query.close();
      }
      guard.raiseIfFailed();
    },
  };
}
