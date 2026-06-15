/**
 * Run a long-running, detached process in a sandbox and manage it by id.
 *
 * `exec` ties a command's lifetime to your request; `sandbox.processes` runs a
 * process detached under the daemon's supervisor, addressed by a stable
 * `process_id`. This starts a process that prints a line per second, follows its
 * output live for a few seconds, polls the log cursor, lists tracked processes,
 * then kills it and confirms the terminal exit — exercising start/follow/logs/
 * list/kill/wait.
 *
 * Run (targets the Neev production API by default; override with NEEV_BASE_URL):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/processes.ts
 */
import { Neev, Signal } from "@neevcloud/sdk";

const neev = new Neev();

const start = Date.now();
// Logs with the milliseconds elapsed since start, so timing is visible.
function log(message: string): void {
  console.error(`[+${String(Date.now() - start).padStart(5)}ms] ${message}`);
}

async function main(): Promise<void> {
  log("creating sandbox…");
  // Platform defaults for template and region; set NEEV_REGION to pin a region.
  const sandbox = await neev.sandboxes.create({
    name: `proc-${Math.random().toString(36).slice(2, 8)}`,
    region: process.env.NEEV_REGION,
  });

  try {
    // Start a detached process that emits a line per second.
    const proc = await sandbox.processes.start("sh", {
      args: ["-c", 'i=1; while true; do echo "tick $i"; i=$((i+1)); sleep 1; done'],
    });
    log(`started ${proc.id} (state: ${proc.state})`);

    // Follow its output live, stopping ourselves after a few lines (the process
    // keeps running in the sandbox until we kill it).
    let lines = 0;
    for await (const event of proc.follow()) {
      if (event.type === "stdout") {
        log(`stdout: ${event.data.trimEnd()}`);
        if (++lines >= 3) break; // leaving the loop aborts the follow stream
      } else if (event.type === "stderr") {
        log(`stderr: ${event.data.trimEnd()}`);
      } else {
        log(`exit ${event.exitCode}`);
      }
    }

    // Poll the captured output from the start with a reconnect-safe cursor.
    const page = await proc.logs({ cursor: 0 });
    log(
      `polled ${page.entries.length} entries, next cursor=${page.cursor}, dropped=${page.dropped}`,
    );

    // List everything the supervisor is tracking.
    const all = await sandbox.processes.list();
    log(`tracked processes: ${all.map((p) => `${p.processId}(${p.state})`).join(", ")}`);

    // Signal it, then wait for the supervisor to record its exit.
    const signalled = await proc.kill(Signal.TERM);
    log(`kill signalled=${signalled}`);
    const final = await proc.wait();
    log(`final state=${final.state} exitCode=${final.exitCode}`);
  } finally {
    log("deleting sandbox…");
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
