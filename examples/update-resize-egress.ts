/**
 * Update a running sandbox in place: resize its cpu/memory and re-scope its
 * egress policy in a single update() call (one PATCH carrying both), without
 * recreating the sandbox or losing its id.
 *
 * Run with (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/update-resize-egress.ts
 */
import { Neev } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

async function main(): Promise<void> {
  // Uses the default template.
  const sandbox = await neev.sandboxes.create({});
  await sandbox.waitUntilReady();
  console.log(`ready ${sandbox.id} — resources: ${JSON.stringify(sandbox.resources)}`);

  // Resize cpu/memory AND re-scope egress in a single update — the SDK sends one
  // PATCH carrying both `resources` and `egress`, and both take effect together.
  // The sandbox keeps its id, name, and preview URLs; disk_gb is not resizable in
  // place. `allowEgress` is the same convenience `create()` accepts (identical
  // wire JSON); pass a full `egress` object for finer control.
  await sandbox.update({
    resources: { cpu: 2, memory_gb: 4 },
    allowEgress: ["api.github.com"],
  });
  console.log(
    `updated ${sandbox.id} in one PATCH — resources: ${JSON.stringify(sandbox.resources)}, ` +
      "egress: allow api.github.com",
  );

  // A fresh get confirms the resize landed and the egress policy is intact — the
  // exact combined-PATCH path AIPLATFORM-1896 concerns (egress must not revert).
  const fresh = await neev.sandboxes.get(sandbox.id);
  console.log(
    `confirmed resources: ${JSON.stringify(fresh.resources)}, egress: ${JSON.stringify(fresh.data.egress)}`,
  );

  await sandbox.delete();
  console.log("cleaned up");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
