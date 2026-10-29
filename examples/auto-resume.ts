/**
 * Use a paused sandbox without resuming it first.
 *
 * Where the platform's automatic wake-up is enabled, a request to a paused sandbox
 * wakes it and is delivered once the sandbox is ready: one slow response instead of
 * an error. This pauses a sandbox, reads a file back with `exec` without calling
 * `resume()`, and prints `RESULT: woke automatically`, `resumed explicitly` or
 * `failed`.
 *
 * If `exec` gets a 429 and the sandbox is still Paused, it calls `resume()` and runs
 * the read-only command once more. In the current backend a 429 on this path is sent
 * before the command runs; that is not an API guarantee, so don't replay commands
 * that change state. A 503 is not replayed.
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/auto-resume.ts
 */
import { APIError, Neev, NeevError, type Sandbox } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

const TEMPLATE = process.env.NEEV_SANDBOX_TEMPLATE_ID ?? "sb-ubuntu-26-04-dev";
const MARKER_FILE = "auto-resume-marker.txt";
const MARKER_TEXT = "written before the pause";
const PHASE_TIMEOUT_MS = 120_000;

// Polls refresh() until done(sandbox) holds, or throws after PHASE_TIMEOUT_MS.
async function waitFor(
  sandbox: Sandbox,
  done: (s: Sandbox) => boolean,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + PHASE_TIMEOUT_MS;
  while (!done(sandbox)) {
    if (Date.now() > deadline) {
      throw new NeevError(`sandbox still ${sandbox.phase}; expected ${expected}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await sandbox.refresh();
  }
}

// Reads the marker back; a different text means the files did not survive.
async function readMarker(sandbox: Sandbox): Promise<void> {
  // The signal bounds the whole read, including a body that stalls after headers.
  const result = await sandbox.exec(["cat", MARKER_FILE], {
    signal: AbortSignal.timeout(PHASE_TIMEOUT_MS),
  });
  const text = result.stdout.trim();
  if (result.exitCode !== 0 || text !== MARKER_TEXT) {
    throw new NeevError(`marker not intact: ${JSON.stringify(text)} ${result.stderr}`);
  }
}

// Reads the marker without resuming; returns which path made it work.
async function usePausedSandbox(sandbox: Sandbox): Promise<string> {
  const started = Date.now();
  const elapsed = () => ((Date.now() - started) / 1000).toFixed(1);
  try {
    await readMarker(sandbox);
    console.log(`woke in ${elapsed()}s`);
    return "woke automatically";
  } catch (err) {
    if (!(err instanceof APIError) || err.status !== 429) throw err;
    await sandbox.refresh();
    if (sandbox.phase !== "Paused") throw err;
    console.log(`429 and still Paused (${err.message}); resuming explicitly`);
  }

  await sandbox.resume();
  // waitUntilReady() gives up at once on Paused, so first wait for resume to take effect.
  await waitFor(sandbox, (s) => s.phase !== "Paused", "to leave Paused");
  await sandbox.waitUntilReady();
  await readMarker(sandbox);
  console.log(`resumed in ${elapsed()}s`);
  return "resumed explicitly";
}

async function main(): Promise<void> {
  let sandbox: Sandbox | undefined;
  try {
    sandbox = await neev.sandboxes.create({ sandbox_template_id: TEMPLATE });
    await sandbox.waitUntilReady();
    await sandbox.files.write(MARKER_FILE, MARKER_TEXT);
    console.log(`ready: ${sandbox.id}`);

    await sandbox.pause();
    await waitFor(sandbox, (s) => s.phase === "Paused", "Paused");
    console.log("paused");

    console.log(`RESULT: ${await usePausedSandbox(sandbox)}`);
  } catch (err) {
    if (!(err instanceof NeevError)) throw err;
    console.error(`Error: ${err.message}`);
    console.log("RESULT: failed");
    process.exitCode = 1;
  } finally {
    // Always clean up the remote sandbox, even if a step above failed.
    if (sandbox) {
      try {
        await sandbox.delete();
      } catch (err) {
        console.error(`cleanup failed, delete ${sandbox.id} by hand: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }
  }
}

main();
