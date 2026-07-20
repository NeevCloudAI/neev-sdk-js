/**
 * Stream a command's output from a sandbox as it is produced.
 *
 * `sandbox.exec(cmd, { stream: true })` returns an async iterable: it yields
 * `stdout`/`stderr` text chunks the moment the sandbox flushes them, then a
 * terminal `exit` event. (Without `stream: true`, `exec` buffers and resolves to
 * the full result.) This runs a command that prints a line per second and logs
 * each chunk with the elapsed time, so the ~1s spacing is visible — proof the
 * output arrives live rather than all at once at the end.
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/streaming-exec.ts
 */
import { Neev } from "@neevcloud/sdk";

const neev = new Neev();

const start = Date.now();
// Logs with the milliseconds elapsed since start, so streaming is visible.
function log(message: string): void {
  console.error(`[+${String(Date.now() - start).padStart(5)}ms] ${message}`);
}

async function main(): Promise<void> {
  log("creating sandbox…");
  // Uses the default template.
  const sandbox = await neev.sandboxes.create({});

  try {
    // Emit one line per second for 5 seconds, then a line on stderr.
    const command = [
      "sh",
      "-c",
      'i=1; while [ $i -le 5 ]; do echo "line $i"; sleep 1; i=$((i+1)); done; echo "(done)" >&2',
    ];

    let exitCode = 0;
    for await (const event of sandbox.exec(command, { stream: true, timeoutMs: 30_000 })) {
      if (event.type === "stdout") log(`stdout: ${event.data.trimEnd()}`);
      else if (event.type === "stderr") log(`stderr: ${event.data.trimEnd()}`);
      else exitCode = event.exitCode;
    }
    log(`exit ${exitCode}`);
  } finally {
    log("deleting sandbox…");
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
