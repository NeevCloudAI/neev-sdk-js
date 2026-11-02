/**
 * Read a sandbox's audit trail: the calls made to it, every program that ran
 * inside it, and every connection those programs opened, newest first.
 *
 * Runs a script through exec, then reads `sandbox.audit()` and ties each
 * program back to the call that started it through its parent chain.
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/audit-trail.ts
 */
import { Neev } from "@neevcloud/sdk";
import type { AuditEvent, AuditTrail } from "@neevcloud/sdk";

const API_ACTIVITY = 6003;
const PROCESS_ACTIVITY = 1007;
const NETWORK_ACTIVITY = 4001;

// Programs and connections can take about a minute to appear, so poll until they do.
async function pageWithPrograms(read: () => Promise<AuditTrail>): Promise<AuditTrail> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const page = await read();
    const hasPrograms = page.data.some((e) => e.class_uid === PROCESS_ACTIVITY);
    if (hasPrograms || Date.now() >= deadline) return page;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

function describe(e: AuditEvent): string {
  switch (e.class_uid) {
    case API_ACTIVITY:
      return `${e.api?.operation} by ${e.actor.user.name ?? e.actor.user.uid}`;
    case PROCESS_ACTIVITY: {
      const p = e.process;
      const ended = e.exit_code !== undefined ? ` exit ${e.exit_code}` : (e.status_detail ?? "");
      return `${p?.name} pid ${p?.pid} (parent ${p?.parent_process?.pid ?? "-"}) ${ended}`.trim();
    }
    case NETWORK_ACTIVITY: {
      const d = e.dst_endpoint;
      const where = d?.name ?? `${d?.ip}:${d?.port}`;
      return `${e.actor.process?.name} pid ${e.actor.process?.pid} -> ${where}`;
    }
    default:
      return e.type_name;
  }
}

// The call that started a program: its own pid, or an ancestor's, is the pid a call recorded.
function startedBy(pid: number | undefined, events: AuditEvent[]): AuditEvent | undefined {
  const calls = new Map<number, AuditEvent>();
  const parent = new Map<number, number>();
  for (const e of events) {
    for (const r of e.resources ?? []) {
      if (r.data?.pid !== undefined) calls.set(r.data.pid, e);
    }
    if (e.class_uid === PROCESS_ACTIVITY && e.activity_id === 1 && e.process?.pid !== undefined) {
      const ppid = e.process.parent_process?.pid;
      if (ppid !== undefined) parent.set(e.process.pid, ppid);
    }
  }
  const seen = new Set<number>();
  for (let p = pid; p !== undefined && !seen.has(p); p = parent.get(p)) {
    seen.add(p);
    const call = calls.get(p);
    if (call) return call;
  }
  return undefined;
}

async function main(): Promise<void> {
  const neev = new Neev();
  const sandbox = await neev.sandboxes.create({
    sandbox_template_id: "sb-ubuntu-26-04-dev",
    allowInternet: true,
  });

  try {
    await sandbox.waitUntilReady();

    // A script that starts programs of its own: none of them is a call you made.
    await sandbox.files.write(
      "work.sh",
      "#!/bin/sh\nls /workspace\ncurl -s -o /dev/null https://example.com\n",
    );
    await sandbox.exec(["sh", "work.sh"]);

    const page = await pageWithPrograms(() => sandbox.audit({ limit: 200 }));
    for (const e of page.data) {
      const pid = e.process?.pid ?? e.actor.process?.pid;
      const call = e.class_uid === API_ACTIVITY ? undefined : startedBy(pid, page.data);
      const via = call
        ? `  <- ${call.api?.operation} by ${call.actor.user.name ?? call.actor.user.uid}`
        : "";
      console.log(new Date(e.time).toISOString(), e.type_name.padEnd(28), describe(e) + via);
    }

    // Filters: `operation` and the actor filters return calls only; `status` covers every class.
    const failed = await sandbox.audit({ status: "failure" });
    console.log(`${failed.data.length} events ended in failure`);
  } finally {
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
