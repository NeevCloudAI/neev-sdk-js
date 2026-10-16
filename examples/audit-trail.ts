/**
 * Read a sandbox's audit trail: what ran inside it, newest first.
 *
 * Runs a few commands and file operations, then pages through
 * `sandbox.audit()`. Each event names the call (`exec`, `fs.write`,
 * `pty_command`, …), who made it, what it touched — a program is recorded
 * without its arguments — and how it ended.
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/audit-trail.ts
 */
import { Neev } from "@neevcloud/sdk";
import type { AuditTrail } from "@neevcloud/sdk";

// Audit events land a few seconds after the call, so poll until the first page has some.
async function firstAuditPage(read: () => Promise<AuditTrail>): Promise<AuditTrail> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const page = await read();
    if (page.data.length > 0 || Date.now() >= deadline) return page;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function main(): Promise<void> {
  const neev = new Neev();
  const sandbox = await neev.sandboxes.create({
    sandbox_template_id: "sb-ubuntu-26-04-dev",
  });

  try {
    await sandbox.waitUntilReady();

    // Generate some activity to audit.
    await sandbox.files.write("notes.txt", "hello\n");
    await sandbox.exec(["sh", "-c", "cat notes.txt && uname -a"]);

    // Read the trail one page at a time, following next_cursor until it runs out.
    let page = await firstAuditPage(() => sandbox.audit({ limit: 20 }));
    console.log(`trail covers ${page.retention_days} days (${page.from} → ${page.to})`);
    while (true) {
      for (const e of page.data) {
        const who = e.actor.user.name ?? e.actor.user.uid;
        console.log(new Date(e.time).toISOString(), e.api.operation, who, e.status);
      }
      if (!page.next_cursor) break;
      page = await sandbox.audit({ limit: 20, cursor: page.next_cursor });
    }

    // Filter: only the programs run through exec, and what they ran.
    const execs = await sandbox.audit({ operation: "exec" });
    for (const e of execs.data) {
      const program = e.resources?.find((r) => r.type === "process")?.name ?? "";
      console.log("exec:", new Date(e.time).toISOString(), program, e.status);
    }
  } finally {
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
