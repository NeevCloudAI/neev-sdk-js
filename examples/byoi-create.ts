/**
 * Bring Your Own Image (BYOI): create a sandbox from a public OCI image instead
 * of a catalogue template, with an explicit start command, then run inside it.
 *
 * Set at most one of `sandbox_template_id` (catalogue) or `image` (BYOI); omit
 * both for the platform default. The image must be a public reference with an
 * explicit tag or digest; `command` overrides the container's default entrypoint.
 *
 * Run with (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/byoi-create.ts
 */
import { Neev } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

async function main(): Promise<void> {
  // Create from a custom image. Keep the container alive so we can exec into it;
  // swap in your own image reference (must include a tag or @sha256 digest).
  const sandbox = await neev.sandboxes.create({
    image: "docker.io/library/python:3.12-slim",
    command: ["sleep", "infinity"],
  });
  console.log(`created ${sandbox.id} from ${sandbox.data.image} (phase: ${sandbox.phase})`);

  try {
    await sandbox.waitUntilReady();

    // Run a command inside the BYOI container to prove the image is live.
    const result = await sandbox.exec(["python", "--version"]);
    console.log(`python in the sandbox: ${result.stdout.trim() || result.stderr.trim()}`);
  } finally {
    // Always clean up the remote sandbox, even if readiness or exec failed.
    await sandbox.delete();
    console.log("cleaned up");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
