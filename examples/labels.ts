/**
 * Label sandboxes at create time, then find them again by label.
 *
 * Creates two sandboxes that share a `run` label, lists by that label alone and
 * by two labels together, prints each sandbox's labels, then deletes both.
 *
 * Uses the default template.
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/labels.ts
 */
import { Neev, type Sandbox } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables. Targets the Neev
// production API by default.
const neev = new Neev();

async function main(): Promise<void> {
  // A per-run value, so the listings below match only this run's sandboxes.
  const run = `run-${Date.now()}`;
  const created: Sandbox[] = [];

  try {
    // Up to 16 labels per sandbox. Keys are lowercase; the server rejects a
    // malformed label with a BadRequestError.
    created.push(await neev.sandboxes.create({ labels: { run, role: "api" } }));
    created.push(await neev.sandboxes.create({ labels: { run, role: "worker" } }));
    for (const sb of created) console.log(`created ${sb.id} labels: ${JSON.stringify(sb.labels)}`);

    // One label: both sandboxes match.
    const all = await neev.sandboxes.list({ labels: { run } });
    console.log(`label run=${run} → ${all.total} sandbox(es)`);

    // Several labels: a sandbox must carry every one of them.
    const workers = await neev.sandboxes.list({ labels: { run, role: "worker" } });
    for (const sb of workers.items) {
      console.log(`run=${run}, role=worker → ${sb.id} ${JSON.stringify(sb.labels)}`);
    }
  } finally {
    // Delete whatever was created, even if a later step failed.
    await Promise.all(created.map((sb) => sb.delete()));
    console.log("cleaned up");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
