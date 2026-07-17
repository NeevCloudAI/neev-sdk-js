/**
 * Use a sandbox as a remote host over SSH.
 *
 * `sandbox.ssh()` opens a local loopback tunnel; point any ssh client, `rsync`,
 * `scp`, or an IDE's Remote-SSH at `{ host, port }` — no keys to manage and no
 * public port. Over a single tunnel this example:
 *   1. runs a command on the sandbox,
 *   2. rsyncs a local directory up into the workspace,
 *   3. port-forwards a server running in the sandbox back to your machine.
 *
 * It creates the sandbox from a bring-your-own image that ships openssh, rsync,
 * and python3 (the default minimal template has none of those). Any image with an
 * SSH-capable userland works.
 *
 * Node only (it opens a local TCP listener) and needs the `ws` package, which the
 * tunnel loads automatically:
 *   npm install ws
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/ssh-tunnel.ts
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Neev } from "@neevcloud/sdk";

// A public image with openssh-client, rsync, and python3 already installed.
const IMAGE = "mcr.microsoft.com/devcontainers/python:3.12";

const start = Date.now();
function log(message: string): void {
  console.error(`[+${String(Date.now() - start).padStart(6)}ms] ${message}`);
}

// Common ssh options that make the demo non-interactive. The tunnel is loopback
// and per-session, so skipping host-key prompts here is safe for the example.
const sshOpts = [
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "LogLevel=ERROR",
];

// run spawns a command, inherits stdio, and resolves with its exit code.
function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function main(): Promise<void> {
  const neev = new Neev();
  log(`creating sandbox from ${IMAGE}…`);
  const sandbox = await neev.sandboxes.create({ image: IMAGE });

  try {
    await sandbox.waitUntilReady({ timeoutMs: 180_000 });
    log(`ready: ${sandbox.id}`);

    const tunnel = await sandbox.ssh();
    log(`tunnel on ${tunnel.host}:${tunnel.port} — e.g. ssh -p ${tunnel.port} neev@localhost`);
    const target = "neev@localhost";
    const P = ["-p", String(tunnel.port), ...sshOpts];

    try {
      // 1. Run a command on the sandbox.
      log("exec: uname + workspace listing");
      await run("ssh", [...P, target, "uname -a; echo; ls -la /workspace"]);

      // 2. rsync a local directory up into the workspace.
      const local = mkdtempSync(join(tmpdir(), "ssh-demo-"));
      writeFileSync(join(local, "hello.txt"), "shipped over rsync\n");
      log("rsync: local dir → sandbox:/workspace/uploaded");
      await run("rsync", [
        "-az",
        "-e",
        `ssh ${P.join(" ")}`,
        `${local}/`,
        `${target}:/workspace/uploaded/`,
      ]);
      await run("ssh", [...P, target, "cat /workspace/uploaded/hello.txt"]);

      // 3. Serve a file from the sandbox and port-forward it back to localhost.
      log("port-forward: python http.server in sandbox → http://localhost:18080");
      await run("ssh", [
        ...P,
        target,
        "cd /workspace && (setsid python3 -m http.server 8080 >/tmp/httpd.log 2>&1 &); sleep 1",
      ]);
      const forward = spawn("ssh", [...P, "-N", "-L", "18080:localhost:8080", target], {
        stdio: "ignore",
      });
      try {
        await new Promise((r) => setTimeout(r, 2000));
        await run("curl", ["-s", "http://localhost:18080/uploaded/hello.txt"]);
      } finally {
        forward.kill();
      }
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
