/**
 * Create a sandbox scoped to GitHub egress, then update it in place: resize its
 * cpu/memory and re-scope egress to Google in a single update() call (one PATCH
 * carrying both), without recreating the sandbox or losing its id.
 *
 * Run with (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/update-resize-egress.ts
 */
import { Neev } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

async function main(): Promise<void> {
  // Create with egress locked to GitHub only (deny-all otherwise). `allowEgress`
  // is the same convenience `update()` accepts — identical wire JSON.
  const sandbox = await neev.sandboxes.create({ allowEgress: ["github.com"] });

  try {
    await sandbox.waitUntilReady();
    console.log(
      `ready ${sandbox.id} — resources: ${JSON.stringify(sandbox.resources)}, egress: ${JSON.stringify(sandbox.data.egress)}`,
    );

    // Resize cpu/memory AND replace the egress policy (GitHub → Google) in a single
    // update — the SDK sends one PATCH carrying both `resources` and `egress`, and
    // both take effect together. The sandbox keeps its id, name, and preview URLs;
    // disk_gb is not resizable in place. Egress replaces the policy in full and
    // needs no restart.
    await sandbox.update({
      resources: { cpu: 2, memory_gb: 4 },
      allowEgress: ["google.com"],
    });
    console.log(
      `updated ${sandbox.id} in one PATCH — resources: ${JSON.stringify(sandbox.resources)}, ` +
        "egress: github.com → google.com",
    );

    // A fresh get confirms the resize landed and the new egress policy is intact —
    // the exact combined-PATCH path AIPLATFORM-1896 concerns (egress must not revert).
    const fresh = await neev.sandboxes.get(sandbox.id);
    console.log(
      `confirmed resources: ${JSON.stringify(fresh.resources)}, egress: ${JSON.stringify(fresh.data.egress)}`,
    );
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
