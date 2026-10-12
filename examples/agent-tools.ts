/**
 * Drive a sandbox through the sandbox tool contract, as an agent's model would.
 *
 * `@neevcloud/sdk/agent-tools` gives your own agent loop the NeevCloud sandbox
 * tools. This prints the tool specs you would declare to a model, then plays a
 * short scripted sequence of model tool calls through `tools.call(name, args)`:
 * write a file, run it, start a background build, follow it with `wait_s`, and
 * show the error results a model gets back for a bad call.
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agent-tools.ts
 */
import { Neev } from "@neevcloud/sdk";
import { DESCRIPTIONS, PARAMETERS, SandboxTools } from "@neevcloud/sdk/agent-tools";

const neev = new Neev();

async function main(): Promise<void> {
  const sandbox = await neev.sandboxes.create({});
  try {
    const tools = new SandboxTools(sandbox, { allowProcesses: true });

    // What you would hand your model's tool-calling API.
    const specs = tools.names().map((name) => ({
      name,
      description: DESCRIPTIONS[name],
      parameters: PARAMETERS[name],
    }));
    console.log(`declaring ${specs.length} tools: ${specs.map((s) => s.name).join(", ")}`);

    // Stand-ins for the tool calls a model would make, in order.
    const script: Array<[string, unknown]> = [
      ["write_file", { path: "hello.py", content: "print('hello from the sandbox')\n" }],
      ["run_command", { command: "python3 hello.py" }],
      ["start_process", { command: "sleep 3; echo build ok" }],
    ];
    let processId = "";
    for (const [name, args] of script) {
      const result = await tools.call(name, args);
      console.log(name, JSON.stringify(result));
      if ("process_id" in result) processId = result.process_id;
    }

    // Following a long command: one read that waits for it to exit.
    const output = await tools.call("read_process_output", { process_id: processId, wait_s: 30 });
    console.log("read_process_output", JSON.stringify(output));

    // Mistakes come back as error results the model can read and correct.
    console.log("run_command {}", JSON.stringify(await tools.call("run_command", {})));
    console.log("rm_rf", JSON.stringify(await tools.call("rm_rf", {})));
  } finally {
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
