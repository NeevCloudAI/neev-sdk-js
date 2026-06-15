/**
 * Manage a pool of detached processes in one sandbox.
 *
 * Starts several background processes, inspects them with `list()` and per-handle
 * `status()`, then stops them all at once with `killAll()` and confirms they
 * exited. This complements `processes.ts` (which follows a single process's
 * output live) by exercising the fleet-management endpoints: start, list,
 * status, kill-all.
 *
 * Run (targets the Neev production API by default; override with NEEV_BASE_URL):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/process-pool.ts
 */
import { Neev, Signal } from "@neevcloud/sdk";

const neev = new Neev();

async function main(): Promise<void> {
  const sandbox = await neev.sandboxes.create({
    name: `pool-${Math.random().toString(36).slice(2, 8)}`,
    region: process.env.NEEV_REGION,
  });

  try {
    // Start three detached workers, each ticking on its own interval.
    const workers = await Promise.all(
      [1, 2, 3].map((n) =>
        sandbox.processes.start("sh", {
          args: ["-c", `while true; do echo "worker ${n}"; sleep ${n}; done`],
        }),
      ),
    );
    console.error(`started ${workers.length} workers: ${workers.map((w) => w.id).join(", ")}`);

    // List everything the supervisor is tracking; all should be running.
    const running = await sandbox.processes.list();
    console.error(
      `list → ${running.map((p) => `${p.name}#${p.processId.slice(0, 9)}(${p.state})`).join(", ")}`,
    );

    // Per-handle status snapshot for the first worker.
    const first = await workers[0].status();
    console.error(`worker 0 status: state=${first.state} exitCode=${first.exitCode}`);

    // Stop the whole pool with a single signal.
    const signalled = await sandbox.processes.killAll(Signal.TERM);
    console.error(`killAll signalled ${signalled} process(es)`);

    // Confirm each worker has exited.
    for (const w of workers) {
      const final = await w.wait();
      console.error(`worker ${w.id.slice(0, 9)} → state=${final.state} exitCode=${final.exitCode}`);
    }
  } finally {
    console.error("deleting sandbox…");
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
