/**
 * Serve a port from an agent, read its audit trail, and keep it from idling out.
 *
 * Exposes a port with a random slug (the URL needs no credential, so treat it as
 * a secret), lists the exposed ports, reads one page of the agent's audit trail,
 * resets its idle timer with `keepalive()`, then revokes the port.
 *
 * Set NEEV_AGENT_TEMPLATE to pick a template (default "claude-code").
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agent-ports-audit.ts
 */
import { Neev } from "@neevcloud/sdk";

const neev = new Neev();

async function main(): Promise<void> {
  // Give the agent a 15-minute idle window (0 would mean no idle limit).
  const agent = await neev.agents.create({
    name: "example-ports-audit",
    agent_template: process.env.NEEV_AGENT_TEMPLATE ?? "claude-code",
    idle_timeout_seconds: 900,
  });

  try {
    await agent.waitUntilReady();
    console.log(
      `ready ${agent.id} (idle window: ${agent.idleTimeoutSeconds ?? "account default"}s)`,
    );

    // Serve something on port 3000 inside the agent's backing sandbox.
    const sandbox = await agent.sandbox();
    await sandbox.files.write("index.html", "<h1>hello from the agent</h1>\n");
    await sandbox.processes.start(["busybox", "httpd", "-f", "-p", "3000"]);

    // Expose the port with a slug of our choosing, then wait until it is routable.
    const port = await agent.exposePort(3000, { slug: randomSlug() });
    console.log(`exposed :${port.port} (slug ${port.slug})`);
    const url = await agent.getUrl({ port: 3000 });
    console.log(`preview URL: ${url}`);
    console.log(`exposed ports: ${(await agent.listPorts()).map((p) => p.port).join(", ")}`);

    // One page of the audit trail. sandbox_id is the agent's backing sandbox.
    const trail = await agent.audit({ limit: 20 });
    console.log(`audit for sandbox ${trail.sandbox_id}:`);
    for (const r of trail.records) {
      console.log(" ", r.at, r.tool, r.command ?? r.target ?? "", r.outcome);
    }

    // Hold the agent past its idle deadline while work is in progress.
    await agent.keepalive();
    console.log("idle timer reset");

    await agent.revokePort(3000);
    console.log("port revoked");
  } finally {
    await agent.delete();
  }
}

// Returns a random 8-character slug of lowercase letters and digits.
function randomSlug(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
