/**
 * Open an SSH tunnel to a sandbox and run a command over it with the system `ssh`.
 *
 * `sandbox.ssh()` binds a local loopback listener and forwards each connection to
 * the sandbox over an authenticated WebSocket, so any ssh client, scp/rsync, or IDE
 * remote-dev points at 127.0.0.1:<port> with no keys to manage and no public port.
 *
 * Node only (it opens a local TCP listener) and it needs the `ws` package, which the
 * tunnel loads automatically:
 *   npm install ws
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/ssh-tunnel.ts
 */
import { spawn } from "node:child_process";
import { Neev } from "@neevcloud/sdk";

const start = Date.now();
function log(message: string): void {
  console.error(`[+${String(Date.now() - start).padStart(5)}ms] ${message}`);
}

// Runs one command over the tunnel with the system ssh client, inheriting stdio.
// Host-key checking is disabled here purely to keep the demo non-interactive.
function ssh(port: number, command: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-p",
        String(port),
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "neev@localhost",
        command,
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function main(): Promise<void> {
  const neev = new Neev();
  log("creating sandbox…");
  const sandbox = await neev.sandboxes.create({});

  try {
    await sandbox.waitUntilReady({ timeoutMs: 120_000 });
    log("ready");

    const tunnel = await sandbox.ssh();
    log(`tunnel listening on ${tunnel.host}:${tunnel.port}`);
    log(`try it yourself: ssh -p ${tunnel.port} neev@localhost`);

    try {
      await ssh(tunnel.port, 'echo "hello from $(hostname)"; pwd');
    } finally {
      await tunnel.close();
      log("tunnel closed");
    }
  } finally {
    log("deleting sandbox…");
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
