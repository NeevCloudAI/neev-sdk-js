/**
 * Serve something from inside a sandbox and get a preview URL for its port.
 *
 * `sandbox.getUrl({ port })` exposes the port and returns its public,
 * credential-free preview URL, waiting until the URL is reachable before it
 * resolves. Ports are private until you expose them; `listPorts`
 * shows what's exposed and `revokePort` stops serving one.
 *
 * The URL needs no credential — a random slug in it is the only thing gating the
 * port — so treat it as a secret. `exposePort(port, { slug })` with a different
 * slug rotates it: the old URL stops working and a new one is returned.
 *
 * This starts a tiny web server on port 3000 and prints its preview URL — open
 * that URL to reach the server.
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/preview-url.ts
 */
import { Neev } from "@neevcloud/sdk";

const start = Date.now();
function log(message: string): void {
  console.error(`[+${String(Date.now() - start).padStart(5)}ms] ${message}`);
}

async function main(): Promise<void> {
  const neev = new Neev();
  log("creating sandbox…");
  const sandbox = await neev.sandboxes.create({
    sandbox_template_id: "sb-ubuntu-24-04-minimal",
  });

  try {
    await sandbox.waitUntilReady({ timeoutMs: 120_000 });
    log("ready");

    // Write a page and serve the workspace on port 3000 (busybox ships with httpd).
    await sandbox.files.write("index.html", "<h1>hello from the sandbox</h1>\n");
    await sandbox.processes.start(["busybox", "httpd", "-f", "-p", "3000"]);
    log("server listening on :3000");

    // Expose the port and wait until its URL is routable.
    const url = await sandbox.getUrl({ port: 3000 });
    log(`preview URL: ${url}`);

    log(`exposed ports: ${JSON.stringify(await sandbox.listPorts())}`);

    // Rotate the URL as you would after a leak: a new slug replaces the old one.
    const rotated = await sandbox.exposePort(3000, { slug: randomSlug() });
    log(`rotated preview URL: ${rotated.preview_url} (the previous URL no longer works)`);

    // Stop serving the port when you're done with it.
    await sandbox.revokePort(3000);
    log(`revoked; exposed ports: ${JSON.stringify(await sandbox.listPorts())}`);
  } finally {
    log("deleting sandbox…");
    await sandbox.delete();
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
