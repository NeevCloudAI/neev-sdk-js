/**
 * AI code-interpreter with live output.
 *
 * NeevCloud `gpt-oss-120b` is given a `run_shell` tool backed by a Neev sandbox.
 * When the model calls it, the command runs in the gVisor-isolated sandbox and
 * its stdout/stderr **stream to your terminal as they are produced** (via
 * `sandbox.exec(cmd, { stream: true })`), not buffered to the end — so you watch
 * the AI's code run live. The full output is then fed back so the model can finish.
 *
 * This is a minimal hand-rolled tool-calling loop (no agent framework) so the
 * tool execution can stream; it talks to the OpenAI-compatible Neev inference
 * endpoint directly and needs only `@neevcloud/sdk`.
 *
 * Install:
 *   npm install @neevcloud/sdk@beta
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agents/ai-interpreter.ts
 *
 * NEEV_API_KEY covers both the sandbox and (by fallback) the model; set
 * NEEV_INFERENCE_API_KEY if your inference key differs.
 */
import { Neev } from "@neevcloud/sdk";
import { NEEV_INFERENCE_BASE_URL, NEEV_MODEL, neevInferenceApiKey } from "./model.js";

// The task the model solves by running shell in the sandbox.
const TASK =
  "Print every prime number below 50, one per line, then on the last line print " +
  "'count: N' with how many there were. Use the run_shell tool; the sandbox has " +
  "busybox sh only (no bash, no python).";

const REGION = process.env.NEEV_REGION ?? "as-south-1";
const MAX_STEPS = 6;

// ANSI helpers for a readable transcript.
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// Writes one transcript line (everything goes to stdout, in order).
function line(text = ""): void {
  process.stdout.write(`${text}\n`);
}

// Minimal shapes of the OpenAI-compatible chat payloads we use.
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run a POSIX sh command in the secure sandbox and return its output.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to run" } },
        required: ["command"],
      },
    },
  },
];

// Token usage reported by one chat-completions round.
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

// One chat-completions round against the Neev inference endpoint.
async function chat(messages: ChatMessage[]): Promise<{ message: ChatMessage; usage?: Usage }> {
  const res = await fetch(`${NEEV_INFERENCE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${neevInferenceApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: NEEV_MODEL, messages, tools: TOOLS, temperature: 0 }),
  });
  if (!res.ok) throw new Error(`inference ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: ChatMessage }[]; usage?: Usage };
  return {
    message: data.choices[0]?.message ?? { role: "assistant", content: "" },
    usage: data.usage,
  };
}

async function main(): Promise<void> {
  const neev = new Neev();
  line(bold("AI code-interpreter (gpt-oss-120b → Neev sandbox)"));
  line(dim(`task: ${TASK}`));

  line(dim(`\n[sandbox] creating (template=sb-ubuntu-26-04-minimal, region=${REGION})…`));
  const sandbox = await neev.sandboxes.create({
    name: `ai-${Math.random().toString(36).slice(2, 8)}`,
    sandbox_template_id: "sb-ubuntu-26-04-minimal",
    region: REGION,
  });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a coding assistant. You have a run_shell tool that executes POSIX sh " +
        "in a secure sandbox (busybox sh; no bash, no python). Use as few commands as " +
        "possible — never re-run a command that already succeeded — then reply with a " +
        "single concise final line.",
    },
    { role: "user", content: TASK },
  ];

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      line(bold(`\n━━━━━ step ${step} ━━━━━`));
      line(dim(`[model] calling ${NEEV_MODEL} with ${messages.length} messages…`));
      const { message, usage } = await chat(messages);
      messages.push(message);
      if (usage) {
        line(
          dim(
            `[model] tokens: prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`,
          ),
        );
      }

      if (message.tool_calls?.length) {
        line(dim(`[model] requested ${message.tool_calls.length} tool call(s)`));
        for (const call of message.tool_calls) {
          const args = JSON.parse(call.function.arguments || "{}") as { command?: string };
          const command = args.command ?? "";
          line(`${dim("[tool] run_shell")}\n  ${cyan(`$ ${command}`)}`);
          line(dim("  ┌─ live output ───────────────────────"));

          // Stream the command's output to the terminal as it runs.
          let stdout = "";
          let stderr = "";
          let exitCode = 0;
          for await (const event of sandbox.exec(["sh", "-c", command], {
            stream: true,
            timeoutMs: 60_000,
          })) {
            if (event.type === "stdout") {
              process.stdout.write(event.data);
              stdout += event.data;
            } else if (event.type === "stderr") {
              process.stdout.write(event.data);
              stderr += event.data;
            } else {
              exitCode = event.exitCode;
            }
          }
          line(dim(`  └─ exit ${exitCode} ────────────────────────`));

          // Feed the result back so the model can continue.
          const result = `exit_code: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
          messages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 4000) });
          line(dim(`[tool] returned ${result.length} bytes to the model`));
        }
        continue;
      }

      // No tool call → the model's final answer.
      line(green(bold("\n✅ final answer:")));
      line(green((message.content ?? "").trim()));
      return;
    }
    line(dim(`\nstopped after ${MAX_STEPS} steps`));
  } finally {
    line(dim(`\n[sandbox] deleting ${sandbox.id}`));
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
