/**
 * Tell a sandbox that crashed and restarted apart from one that quietly lost its
 * files.
 *
 * A restarted sandbox reads back as Ready with an empty /workspace, which is
 * indistinguishable from a sandbox that never had the files — unless you read
 * `sandbox.lastCrash`. This example seeds a marker file, forces a real OOM kill,
 * waits for the crash record to appear, and checks the marker against
 * `storage_reset` to show the two cases really are distinct.
 *
 * Deliberately small memory (1 GB) so the OOM lands quickly.
 *
 * Run with (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/last-crash.ts
 */
import { Neev, type Sandbox } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

const MARKER = "/workspace/marker.txt";

// Poll refresh() until the server reports a crash. The handle caches its snapshot —
// exec and files do NOT update it — so refresh() is the only way to pick up a crash
// detected after the handle was fetched. Returns false if none appeared in time.
async function waitForCrash(sandbox: Sandbox, timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sandbox.refresh();
    if (sandbox.lastCrash) return true;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return false;
}

async function main(): Promise<void> {
  const sandbox = await neev.sandboxes.create({ resources: { cpu: 1, memory_gb: 1 } });

  try {
    await sandbox.waitUntilReady();

    // A sandbox that has never crashed reads null — not an empty object, and not a
    // record with storage_reset: false. All three cases are distinct.
    console.log(`ready ${sandbox.id} — lastCrash: ${JSON.stringify(sandbox.lastCrash)}`);

    // Seed a marker under /workspace. This is the file whose survival we check later.
    await sandbox.files.write(MARKER, "written before the crash");
    console.log(`seeded ${MARKER}`);

    // Force a container-level OOM by filling /dev/shm. Growing an ordinary child
    // process does NOT work: the kernel kills that one process and the sandbox keeps
    // running, so nothing is recorded. tmpfs pages are charged to the sandbox's own
    // memory, so overflowing them takes the whole sandbox down and it restarts.
    //
    // Note the argv array: exec does not run a bare string through a shell — it
    // treats the whole string as one program name — so shell syntax needs ["sh","-c"].
    console.log("forcing an OOM (this takes up to a minute)...");
    await sandbox
      .exec(["sh", "-c", "dd if=/dev/zero of=/dev/shm/balloon bs=1M count=3072"], {
        timeoutMs: 120_000,
      })
      .catch((err) =>
        console.log(`exec died with the sandbox, as expected: ${(err as Error).message}`),
      );

    // No crash record means the example proved nothing — the OOM never took the
    // sandbox down, or it did and the server never reported it. Either way this is a
    // failure, not a quiet success: exiting 0 here would look like the crash path had
    // been verified when it never ran.
    if (!(await waitForCrash(sandbox))) {
      throw new Error("no crash record appeared within the timeout");
    }

    const crash = sandbox.lastCrash;
    console.log(`lastCrash: ${JSON.stringify(crash)}`);

    // The point of the example: storage_reset tells you whether the restart took
    // /workspace with it. Prove it by checking the marker written before the crash.
    await sandbox.waitUntilReady();
    const markerSurvived = await sandbox.files.exists(MARKER);
    console.log(
      `storage_reset: ${crash?.storage_reset} — marker ${markerSurvived ? "still there" : "gone"}`,
    );

    if (crash?.storage_reset) {
      // Everything under /workspace, and anything installed since create, is gone.
      // Re-seed before trusting the sandbox again.
      await sandbox.files.write(MARKER, "re-seeded after the storage reset");
      console.log("re-seeded the workspace");
    }
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
