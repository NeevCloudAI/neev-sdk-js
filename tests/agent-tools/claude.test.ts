import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { FATAL_ERROR, PARAMETERS, TITLES } from "../../src/agent-tools.js";
import { type ClaudeOptions, type ClaudeQuery, toClaude } from "../../src/agent-tools/claude.js";
import { AuthenticationError } from "../../src/errors.js";
import { ALL, fakeTools } from "./sandbox.js";

// Connects an MCP client to the in-process server, the way the Claude Code CLI reaches it.
async function connect(options: ClaudeOptions) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = options.mcpServers.neev as unknown as {
    instance: { connect(t: unknown): Promise<void> };
  };
  await server.instance.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

const toolUse = (name: string, input: unknown) =>
  ({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t1", name, input }] },
  }) as unknown as SDKMessage;

const result = { type: "result", subtype: "success", result: "done" } as unknown as SDKMessage;

// Stands in for query(): yields each message, running a step first when one is given.
function fakeQuery(steps: Array<SDKMessage | (() => Promise<void>)>) {
  const q = {
    closed: false,
    close() {
      q.closed = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const step of steps) {
        if (typeof step === "function") await step();
        else yield step;
      }
    },
  };
  return q satisfies ClaudeQuery;
}

async function drain(messages: AsyncIterable<SDKMessage>) {
  const seen: SDKMessage[] = [];
  for await (const msg of messages) seen.push(msg);
  return seen;
}

describe("toClaude", () => {
  it("gives Claude the sandbox tools and nothing else", () => {
    const opts = toClaude(fakeTools(ALL).tools).options();
    expect(opts.tools).toEqual([]);
    expect(Object.keys(opts.mcpServers)).toEqual(["neev"]);
    expect(opts.strictMcpConfig).toBe(true);
    expect(opts.settingSources).toEqual([]);
    expect(opts.permissionMode).toBe("dontAsk");
    expect(opts.allowedTools).toEqual(
      fakeTools(ALL)
        .tools.names()
        .map((name) => `mcp__neev__${name}`),
    );
  });

  it("publishes every enabled tool with its schema", async () => {
    const { tools } = fakeTools(ALL);
    const listed = (await (await connect(toClaude(tools).options())).listTools()).tools;
    expect(listed.map((t) => t.name)).toEqual(tools.names());
    for (const t of listed) {
      const want = PARAMETERS[t.name as keyof typeof PARAMETERS] as {
        properties: object;
        required: string[];
      };
      expect(Object.keys(t.inputSchema.properties ?? {}), t.name).toEqual(
        Object.keys(want.properties),
      );
      expect(t.inputSchema.required ?? [], t.name).toEqual(want.required);
      expect(t.inputSchema.additionalProperties, t.name).toBe(false);
      expect(t.description, t.name).toBe(tools.specs().find((s) => s.name === t.name)?.description);
      expect(t.annotations?.title, t.name).toBe(TITLES[t.name as keyof typeof TITLES]);
    }
  });

  it("returns a tool result to Claude as JSON text", async () => {
    const { tools, calls } = fakeTools();
    const client = await connect(toClaude(tools).options());
    const res = await client.callTool({ name: "run_command", arguments: { command: "echo hi" } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse((res.content as Array<{ text: string }>)[0]?.text ?? "")).toEqual({
      exit_code: 0,
      stdout: "hi\n",
      stderr: "",
    });
    expect(calls).toEqual([
      ["exec", "sh", { args: ["-lc", "echo hi"], cwd: undefined, timeoutMs: 60_000 }],
    ]);
  });

  it("returns arguments outside the schema to Claude without a sandbox call", async () => {
    const { tools, calls } = fakeTools();
    const claude = toClaude(tools);
    const client = await connect(claude.options());
    const res = await client.callTool({
      name: "run_command",
      arguments: { command: "ls", extra: 1 },
    });
    expect(res.isError).toBe(true);
    expect(calls).toEqual([]);
    expect(claude.guard.failed).toBe(false);
  });

  it("marks only the fatal result as an error and keeps the error text from Claude", async () => {
    const { tools } = fakeTools();
    const claude = toClaude(tools);
    const client = await connect(claude.options());
    const res = await client.callTool({ name: "read_file", arguments: { path: "boom.txt" } });
    expect(res).toMatchObject({
      content: [{ type: "text", text: JSON.stringify({ error: FATAL_ERROR }) }],
      isError: true,
    });
    expect(JSON.stringify(res)).not.toContain("org-123");
    expect(claude.guard.error).toBeInstanceOf(AuthenticationError);
  });

  it("watch stops at a fatal call, closes the query and throws its error", async () => {
    const { tools } = fakeTools();
    const claude = toClaude(tools);
    const options = claude.options();
    const seen: SDKMessage[] = [];
    const q = fakeQuery([
      toolUse("mcp__neev__read_file", { path: "boom.txt" }),
      async () => {
        await (await connect(options)).callTool({
          name: "read_file",
          arguments: { path: "boom.txt" },
        });
      },
      { type: "user" } as unknown as SDKMessage,
      result,
    ]);
    await expect(
      (async () => {
        for await (const msg of claude.watch(q)) seen.push(msg);
      })(),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(seen.map((m) => m.type)).toEqual(["assistant"]);
    expect(q.closed).toBe(true);
  });

  it("watch yields every message of a clean run and closes the query", async () => {
    const claude = toClaude(fakeTools().tools);
    const q = fakeQuery([toolUse("mcp__neev__run_command", { command: "ls" }), result]);
    expect((await drain(claude.watch(q))).map((m) => m.type)).toEqual(["assistant", "result"]);
    expect(q.closed).toBe(true);
  });

  it("watch throws when Claude uses a host tool", async () => {
    const claude = toClaude(fakeTools().tools);
    const q = fakeQuery([toolUse("Bash", { command: "rm -rf /" }), result]);
    await expect(drain(claude.watch(q))).rejects.toThrow("host tools were used: Bash");
    expect(q.closed).toBe(true);
  });

  it("watch closes the query when the caller stops early", async () => {
    const claude = toClaude(fakeTools().tools);
    const q = fakeQuery([result, result]);
    for await (const _msg of claude.watch(q)) break;
    expect(q.closed).toBe(true);
  });
});
