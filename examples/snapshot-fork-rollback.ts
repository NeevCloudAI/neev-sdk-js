/**
 * Snapshot a sandbox, fork it into a fresh sandbox seeded from that state, then
 * roll the original back in place to the same snapshot.
 *
 * Run with (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/snapshot-fork-rollback.ts
 */
import { Neev } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

async function main(): Promise<void> {
  // Uses the default template.
  const sandbox = await neev.sandboxes.create({});
  await sandbox.waitUntilReady();
  await sandbox.files.write("state.txt", "captured-at-snapshot");
  console.log(`source ${sandbox.id} ready with state written`);

  // Capture a snapshot and block until it is Ready. A snapshot is created
  // Pending and must be Ready before it can be rolled back to or forked from;
  // waitUntilReady polls until then (or throws if the capture fails).
  const snapshot = await sandbox.snapshot({ name: "demo-snap", waitUntilReady: true });
  console.log(`snapshot ${snapshot.id} ready (${snapshot.size_bytes ?? "?"} bytes)`);

  // Fork a brand-new sandbox from the source's *current* live state. Fork
  // snapshots the current state atomically — it does not consume the snapshot
  // captured above (that snapshot is used by the rollback below).
  const fork = await neev.sandboxes.fork(sandbox.id, "snapshot-fork");
  await fork.waitUntilReady();
  console.log(`forked ${fork.id} carries: ${(await fork.files.readText("state.txt")).trim()}`);

  // Roll the original sandbox back in place to the snapshot. Rollback is an async
  // state transition, so wait for the sandbox to come back Ready before cleanup —
  // otherwise the delete races the in-progress rollback and we never confirm the
  // rolled-back sandbox is usable.
  await sandbox.rollback(snapshot.id);
  await sandbox.waitUntilReady();
  console.log(`rolled back ${sandbox.id} (phase: ${sandbox.phase})`);

  // Clean up everything created by this example.
  await Promise.all([sandbox.delete(), fork.delete(), neev.sandboxes.deleteSnapshot(snapshot.id)]);
  console.log("cleaned up sandboxes and snapshot");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
