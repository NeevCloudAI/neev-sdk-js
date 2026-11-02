/**
 * Snapshot a running agent, fork it, and roll it back.
 *
 * - `agent.snapshot({ waitUntilReady: true })` snapshots the sandbox backing the
 *   agent and waits until the snapshot is Ready.
 * - `agent.fork(name)` creates a **new agent** from the agent's current state. The
 *   source keeps running; the fork is Provisioning until `waitUntilReady()`.
 * - `agent.rollback(snapshotId)` returns the agent's sandbox to the snapshot in
 *   place. The agent keeps its id and name.
 *
 * A paused or still-provisioning agent raises `ConflictError` (409) or
 * `TooEarlyError` (425) instead.
 *
 * Set NEEV_AGENT_TEMPLATE to pick a template (default "claude-code").
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agent-snapshot-fork-rollback.ts
 */
import { Neev } from "@neevcloud/sdk";
import type { Agent, SnapshotData } from "@neevcloud/sdk";

const MESSAGE_PATH = "demo/message.txt";

const neev = new Neev();

// Reads the demo file through the agent's backing sandbox.
async function readMessage(agent: Agent): Promise<string> {
  const sandbox = await agent.sandbox();
  await sandbox.waitUntilReady();
  return (await sandbox.files.readText(MESSAGE_PATH)).trim();
}

async function main(): Promise<void> {
  let agent: Agent | undefined;
  let fork: Agent | undefined;
  let snapshot: SnapshotData | undefined;
  try {
    agent = await neev.agents.create({
      name: "snapshot-demo",
      agent_template: process.env.NEEV_AGENT_TEMPLATE ?? "claude-code",
    });
    await agent.waitUntilReady();
    console.error(`ready: ${agent.id}`);

    const sandbox = await agent.sandbox();
    await sandbox.waitUntilReady();
    await sandbox.files.write(MESSAGE_PATH, "original state");

    // Snapshot the agent and block until the snapshot is Ready.
    snapshot = await agent.snapshot({ name: "before-change", waitUntilReady: true });
    console.error(`snapshot ${snapshot.id} is ${snapshot.status}`);
    const { items } = await agent.snapshots();
    console.log(`agent snapshots: ${items.map((s) => s.name).join(", ")}`);

    await sandbox.files.write(MESSAGE_PATH, "modified state");

    // Fork returns the new agent, Provisioning until ready. The source keeps running.
    fork = await agent.fork("snapshot-demo-fork");
    console.error(`forked: ${fork.id} (${fork.status})`);
    await fork.waitUntilReady();
    console.log(`fork has: ${await readMessage(fork)}`);

    // Roll the original back in place; it keeps its id and name.
    await agent.rollback(snapshot.id);
    await agent.waitUntilReady();
    console.log(`after rollback, ${agent.name} (${agent.id}) has: ${await readMessage(agent)}`);
  } finally {
    // The snapshot goes before the agent it was taken from.
    if (snapshot) await neev.sandboxes.deleteSnapshot(snapshot.id);
    if (fork) await fork.delete();
    if (agent) await agent.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
