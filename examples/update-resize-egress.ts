/**
 * Update a running sandbox in place: resize its cpu/memory, then re-scope its
 * egress policy — both without recreating the sandbox or losing its id.
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

  // Resize cpu/memory in place. The sandbox keeps its id, name, and preview URLs;
  // disk_gb is not resizable in place. A single update can also carry `egress`,
  // sending one PATCH for both — here we do it in two steps for clarity.
  await sandbox.update({ resources: { cpu: 2, memory_gb: 4 } });
  console.log(`resized ${sandbox.id} — resources: ${JSON.stringify(sandbox.resources)}`);

  // Re-scope egress: replace the policy in full so only api.github.com is
  // reachable. Takes effect for new connections with no restart. `allowEgress`
  // is the same convenience `create()` accepts; pass a full `egress` object for
  // finer control.
  await sandbox.update({ allowEgress: ["api.github.com"] });
  console.log(`egress re-scoped on ${sandbox.id} (allow: api.github.com)`);

  // A get reflects the new shape.
  const fresh = await neev.sandboxes.get(sandbox.id);
  console.log(`confirmed resources: ${JSON.stringify(fresh.resources)}`);

  await sandbox.delete();
  console.log("cleaned up");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
