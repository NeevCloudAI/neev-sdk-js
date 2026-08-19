/**
 * Create a sandbox, wait for it to become Ready, read its metrics, then clean up.
 *
 * Uses the default template.
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/create-sandbox.ts
 */
import { Neev } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables. Targets the Neev
// production API by default.
const neev = new Neev();

async function main(): Promise<void> {
  // Provision a sandbox from the platform defaults. (Browse the catalogue with
  // `neev.templates.list()` to choose a specific template via
  // `sandbox_template_id`.)
  // Egress is deny-all by default — add `allowInternet: true`, or
  // `allowEgress: ["github.com", "*.npmjs.org"]` for specific hosts, to open it.
  const sandbox = await neev.sandboxes.create({});
  console.log(`created ${sandbox.id} (phase: ${sandbox.phase})`);

  // Block until the platform reports the sandbox as Ready.
  await sandbox.waitUntilReady();
  console.log(`ready at ${sandbox.connectUrl ?? "(no connect url)"}`);

  // Read the live metric series for the sandbox.
  const metrics = await sandbox.metrics();
  console.log(`metric series: ${metrics.series.map((s) => s.metric).join(", ")}`);

  // Resize cpu/memory in place (no restart); disk is not resizable this way.
  await sandbox.update({ resources: { cpu: 2, memory_gb: 4 } });
  console.log(`resized to ${sandbox.resources?.cpu} vCPU / ${sandbox.resources?.memory_gb} GB`);

  // Pause to release compute, then delete to clean up.
  await sandbox.pause();
  console.log(`paused (replicas: ${sandbox.replicas})`);
  await sandbox.delete();
  console.log("deleted");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
