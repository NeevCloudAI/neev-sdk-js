/**
 * Run Docker inside a sandbox.
 *
 * The `sb-ubuntu-26-04-docker` template starts its own Docker daemon at boot, so
 * use `docker` as usual (run `start-docker` if the daemon ever stops), with two rules:
 *   - run and build with `--network=host` (compose: `network_mode: host`);
 *   - start containers that keep running, such as `docker compose up`, with
 *     `sandbox.processes.start`, not `exec`, which waits for the command to finish.
 * The template's default egress allows pulls from Docker Hub and GHCR.
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/docker.ts
 */
import { Neev } from "@neevcloud/sdk";

async function main(): Promise<void> {
  const neev = new Neev();
  const sandbox = await neev.sandboxes.create({
    sandbox_template_id: "sb-ubuntu-26-04-docker",
  });

  try {
    await sandbox.waitUntilReady();

    // The first run pulls the image, so allow it a couple of minutes.
    const run = await sandbox.exec(["docker", "run", "--rm", "--network=host", "hello-world"], {
      timeoutMs: 180_000,
    });
    console.log(run.stdout.trim());
    if (run.exitCode !== 0) throw new Error(`docker run failed: ${run.stderr}`);
  } finally {
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
