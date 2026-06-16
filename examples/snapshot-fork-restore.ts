/**
 * Snapshot a sandbox, fork it into a fresh sandbox seeded from that state, then
 * restore the original in place from the same snapshot.
 *
 * Run with (targets the Neev production API by default; set the region with
 * NEEV_REGION):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/snapshot-fork-restore.ts
 */
import { Neev } from "@neevcloud/sdk";
import type { SnapshotData } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

// Poll a snapshot until it reaches a terminal state. A snapshot is created
// Pending and must be Ready before it can be restored or forked from.
async function waitForSnapshot(id: string, timeoutMs = 120_000): Promise<SnapshotData> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await neev.sandboxes.getSnapshot(id);
    if (snap.status === "Ready") return snap;
    if (snap.status === "Failed")
      throw new Error(`snapshot ${id} failed: ${snap.error_message ?? ""}`);
    if (Date.now() > deadline) throw new Error(`snapshot ${id} not ready within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main(): Promise<void> {
  // Template and region use the platform defaults; set NEEV_REGION to pin a
  // region.
  const sandbox = await neev.sandboxes.create({
    name: "snapshot-source",
    region: process.env.NEEV_REGION,
  });
  await sandbox.waitUntilReady();
  await sandbox.files.write("state.txt", "captured-at-snapshot");
  console.log(`source ${sandbox.id} ready with state written`);

  // Capture a filesystem snapshot and wait for it to become Ready.
  const pending = await sandbox.snapshot({ name: "demo-snap" });
  const snapshot = await waitForSnapshot(pending.id);
  console.log(`snapshot ${snapshot.id} ready (${snapshot.size_bytes ?? "?"} bytes)`);

  // Fork a brand-new sandbox from the source's *current* live state. Fork
  // snapshots the current state atomically — it does not consume the snapshot
  // captured above (that snapshot is used by the restore below).
  const fork = await neev.sandboxes.fork(sandbox.id, "snapshot-fork");
  await fork.waitUntilReady();
  console.log(`forked ${fork.id} carries: ${(await fork.files.readText("state.txt")).trim()}`);

  // Restore the original sandbox in place from the snapshot. Restore is an async
  // state transition, so wait for the sandbox to come back Ready before cleanup —
  // otherwise the delete races the in-progress restore and we never confirm the
  // restored sandbox is usable.
  await sandbox.restore(snapshot.id);
  await sandbox.waitUntilReady();
  console.log(`restored ${sandbox.id} (phase: ${sandbox.phase})`);

  // Clean up everything created by this example.
  await Promise.all([sandbox.delete(), fork.delete(), neev.sandboxes.deleteSnapshot(snapshot.id)]);
  console.log("cleaned up sandboxes and snapshot");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
