/**
 * Read a sandbox's audit trail: what ran inside it, newest first.
 *
 * Runs a few commands and file operations, then pages through
 * `sandbox.audit()`. Events are OCSF: an API call (`exec`, `fs.write`,
 * `pty_command`, …) with who made it, plus every program the sandbox ran and
 * every connection it opened, whether or not anything asked for them. A
 * program is recorded without its arguments.
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/audit-trail.ts
 */
import { Neev } from "@neevcloud/sdk";
import type { AuditEvent, AuditTrail } from "@neevcloud/sdk";

// One line per event: the API call, or the program and what it did.
function describe(e: AuditEvent): string {
  if (e.api) return `${e.api.operation} by ${e.actor.user.name ?? e.actor.user.uid}`;
  if (e.dst_endpoint) {
    const dst = e.dst_endpoint.name ?? `${e.dst_endpoint.ip}:${e.dst_endpoint.port}`;
    return `${e.actor.process?.name ?? "?"} connect ${dst}`;
  }
  const exit = e.exit_code !== undefined ? ` exit ${e.exit_code}` : "";
  return `${e.process?.name ?? "?"} ${e.activity_name.toLowerCase()}${exit}`;
}

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
        console.log(new Date(e.time).toISOString(), describe(e), e.status);
      }
      if (!page.next_cursor) break;
      page = await sandbox.audit({ limit: 20, cursor: page.next_cursor });
    }

    // Filter: exec calls and program launches, and what they ran.
    const execs = await sandbox.audit({ operation: "exec" });
    for (const e of execs.data) {
      const program = e.api
        ? (e.resources?.find((r) => r.type === "process")?.name ?? "")
        : (e.process?.name ?? "");
      console.log("exec:", new Date(e.time).toISOString(), e.class_name, program, e.status);
    }
  } finally {
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
