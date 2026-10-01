/**
 * Read a sandbox's audit trail: what ran inside it, newest first.
 *
 * Runs a few commands and file operations, then pages through
 * `sandbox.audit()`. Each record names the operation (`exec`, `fs.write`,
 * `pty_command`, …), the program that ran — never its arguments — or the file it
 * acted on, the credential it was made under, and how it ended.
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/audit-trail.ts
 */
import { Neev } from "@neevcloud/sdk";

async function main(): Promise<void> {
  const neev = new Neev();
  const sandbox = await neev.sandboxes.create({
    sandbox_template_id: "sb-ubuntu-24-04-minimal",
  });

  try {
    await sandbox.waitUntilReady();

    // Generate some activity to audit.
    await sandbox.files.write("notes.txt", "hello\n");
    await sandbox.exec(["sh", "-c", "cat notes.txt && uname -a"]);

    // Read the trail one page at a time, following next_cursor until it runs out.
    let page = await sandbox.audit({ limit: 20 });
    console.log(`trail covers ${page.retention_days} days (${page.from} → ${page.to})`);
    while (true) {
      for (const r of page.records) {
        console.log(r.at, r.tool, r.command ?? r.target ?? "", r.outcome, r.caller_source ?? "");
      }
      if (!page.next_cursor) break;
      page = await sandbox.audit({ limit: 20, cursor: page.next_cursor });
    }
  } finally {
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
