/**
 * Create a sandbox with a capped lifetime and a short idle window, then hold it
 * alive past that idle deadline with a keepalive loop. Also shows changing the
 * windows in place with updateTimeout().
 *
 * Run with (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/lifecycle-keepalive.ts
 */
import { Neev } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // Create with lifecycle windows (all in seconds): pause after 30s idle, and
  // never run longer than 1h total. Omitting `lifecycle` would use account
  // defaults instead. `on_idle` must be "pause" or "delete".
  const sandbox = await neev.sandboxes.create({
    lifecycle: { idle_timeout_seconds: 30, max_lifetime_seconds: 3600, on_idle: "pause" },
  });

  try {
    await sandbox.waitUntilReady();
    console.log(`ready ${sandbox.id} — idle_expires_at: ${sandbox.data.idle_expires_at}`);

    // Keepalive loop: reset the idle timer every 10s, five times (~50s > the 30s
    // idle window), so the sandbox stays running instead of pausing. In a real
    // agent you'd call this once per turn while work is in progress.
    for (let i = 1; i <= 5; i++) {
      await sleep(10_000);
      await sandbox.keepalive();
      console.log(
        `keepalive ${i}/5 — phase: ${sandbox.phase}, idle_expires_at: ${sandbox.data.idle_expires_at}`,
      );
    }

    // Widen the idle window in place (seconds). Only the fields passed change; send
    // 0 to turn a window off, or omit it to leave it unchanged.
    await sandbox.updateTimeout({ idle_timeout_seconds: 300 });
    console.log(`idle window widened — idle_timeout_seconds: ${sandbox.data.idle_timeout_seconds}`);
  } finally {
    // Always clean up the remote sandbox, even if a step above failed.
    await sandbox.delete();
    console.log("cleaned up");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
