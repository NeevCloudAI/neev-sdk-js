/**
 * Provision an agent from a catalogue template, wait for it to become Ready,
 * drive its backing sandbox, then clean up.
 *
 * Set NEEV_AGENT_TEMPLATE to pick a template (default "claude-code") and
 * NEEV_BASE_URL to target another environment.
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/create-agent.ts
 */
import { Neev } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables. Targets the Neev
// production API by default.
const neev = new Neev();

async function main(): Promise<void> {
  // Browse the agent-template catalogue so the run shows what is available.
  const { items } = await neev.agentTemplates.list();
  console.log(`templates: ${items.map((t) => t.name).join(", ") || "(none)"}`);

  // Provision an agent from a template. It starts Provisioning.
  // The agent's backing sandbox is deny-all egress by default — add
  // `allowInternet: true`, or `allowEgress: ["api.anthropic.com"]` for specific hosts.
  const agent = await neev.agents.create({
    name: "example-coder",
    agent_template: process.env.NEEV_AGENT_TEMPLATE ?? "claude-code",
  });
  console.log(`created ${agent.id} (status: ${agent.status}, sandbox: ${agent.sandboxId})`);

  // Block until the platform reports the agent as Ready.
  await agent.waitUntilReady();
  console.log("ready");

  // Reach the agent's environment through its backing sandbox.
  const sandbox = await agent.sandbox();
  await sandbox.files.write("notes.md", "# scratch\n");
  const { stdout } = await sandbox.exec(["ls", "-la"]);
  console.log(stdout.trimEnd());

  // Resize cpu/memory in place (no recreate); disk is not resizable this way.
  await agent.update({ resources: { cpu: 2, memory_gb: 4 } });
  console.log("resized");

  // Pause to release compute, then delete to clean up (also removes the sandbox).
  await agent.pause();
  console.log(`paused (status: ${agent.status})`);
  await agent.delete();
  console.log("deleted");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
