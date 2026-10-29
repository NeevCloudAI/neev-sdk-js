/**
 * Use a paused agent without resuming it first.
 *
 * Pausing an agent pauses its backing sandbox. Where the platform's automatic
 * wake-up is enabled, a request to that sandbox wakes it and is delivered once it is
 * ready: one slow response instead of an error. This pauses an agent, reads a file
 * back through `agent.sandbox()`'s `exec` without calling `agent.resume()`, and
 * prints `RESULT: woke automatically`, `resumed explicitly` or `failed`.
 *
 * If `exec` gets a 429 and the agent is still Paused, it calls `agent.resume()` and
 * runs the read-only command once more. In the current backend a 429 on this path is
 * sent before the command runs; that is not an API guarantee, so don't replay
 * commands that change state. A 503 is not replayed.
 *
 * Set NEEV_AGENT_TEMPLATE to pick a template (default "claude-code").
 *
 * Run:
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/agent-auto-resume.ts
 */
import { APIError, type Agent, Neev, NeevError, type Sandbox } from "@neevcloud/sdk";

// Construct the client from NEEV_* environment variables.
const neev = new Neev();

const AGENT_TEMPLATE = process.env.NEEV_AGENT_TEMPLATE ?? "claude-code";
const MARKER_FILE = "auto-resume-marker.txt";
const MARKER_TEXT = "written before the pause";
const PHASE_TIMEOUT_MS = 120_000;

// Polls refresh() until done(agent) holds, or throws after PHASE_TIMEOUT_MS.
async function waitFor(agent: Agent, done: (a: Agent) => boolean, expected: string): Promise<void> {
  const deadline = Date.now() + PHASE_TIMEOUT_MS;
  while (!done(agent)) {
    if (Date.now() > deadline) {
      throw new NeevError(`agent still ${agent.status}; expected ${expected}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await agent.refresh();
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
async function usePausedAgent(agent: Agent, sandbox: Sandbox): Promise<string> {
  console.log(`reading ${MARKER_FILE} from the paused agent, without calling resume()...`);
  const started = Date.now();
  const elapsed = () => ((Date.now() - started) / 1000).toFixed(1);
  try {
    await readMarker(sandbox);
    console.log(`file read back intact after ${elapsed()}s`);
    return "woke automatically";
  } catch (err) {
    if (!(err instanceof APIError) || err.status !== 429) throw err;
    await agent.refresh();
    if (agent.status !== "Paused") throw err;
    console.log(`the read was refused with 429 and the agent is still Paused (${err.message})`);
    console.log("calling resume() and reading the file again...");
  }

  await agent.resume();
  // waitUntilReady() gives up at once on Paused, so first wait for resume to take effect.
  await waitFor(agent, (a) => a.status !== "Paused", "to leave Paused");
  await agent.waitUntilReady();
  await readMarker(sandbox);
  console.log(`file read back intact after ${elapsed()}s`);
  return "resumed explicitly";
}

async function main(): Promise<void> {
  let agent: Agent | undefined;
  try {
    agent = await neev.agents.create({ name: "auto-resume-demo", agent_template: AGENT_TEMPLATE });
    console.log(`created agent ${agent.id}, waiting for it to be Ready...`);
    await agent.waitUntilReady();
    const sandbox = await agent.sandbox();
    await sandbox.waitUntilReady();
    await sandbox.files.write(MARKER_FILE, MARKER_TEXT);
    console.log(`agent is Ready; wrote ${MARKER_FILE} into its sandbox ${agent.sandboxId}`);

    await agent.pause();
    await waitFor(agent, (a) => a.status === "Paused", "Paused");
    console.log(`agent paused (status: ${agent.status})`);

    const result = await usePausedAgent(agent, sandbox);
    await agent.refresh();
    console.log(`agent status now: ${agent.status}`);
    console.log(`RESULT: ${result}`);
  } catch (err) {
    if (!(err instanceof NeevError)) throw err;
    console.error(`Error: ${err.message}`);
    console.log("RESULT: failed");
    process.exitCode = 1;
  } finally {
    // Always clean up the remote agent, even if a step above failed.
    if (agent) {
      try {
        await agent.delete();
        console.log(`deleted agent ${agent.id}`);
      } catch (err) {
        console.error(`cleanup failed, delete ${agent.id} by hand: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }
  }
}

main();
