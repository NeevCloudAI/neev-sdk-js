/**
 * Work with a sandbox's filesystem: write, read, inspect, organise, list, and
 * watch for changes as they happen.
 *
 * `sandbox.files` behaves like an ordinary filesystem rooted at the sandbox
 * workspace (paths are relative to it). This example keeps a live `files.watch`
 * running in the background, then writes a file, reads it back, checks it,
 * makes a directory, moves the file in, lists the tree, and cleans up — so each
 * operation shows up as a `change:` line the moment it lands.
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/files.ts
 */
import { Neev } from "@neevcloud/sdk";

const neev = new Neev();

const start = Date.now();
// Logs with the milliseconds elapsed since start, so the live watch is visible.
function log(message: string): void {
  console.error(`[+${String(Date.now() - start).padStart(5)}ms] ${message}`);
}

async function main(): Promise<void> {
  log("creating sandbox…");
  const sandbox = await neev.sandboxes.create({});

  try {
    // Watch the whole workspace in the background. `files.watch` is an async
    // iterable of change events; we stop it with an AbortSignal once we're done.
    const stop = new AbortController();
    const watching = (async () => {
      try {
        for await (const ev of sandbox.files.watch(".", {
          recursive: true,
          signal: stop.signal,
        })) {
          log(`  change: ${ev.type} ${ev.path}`);
        }
      } catch (err) {
        // Aborting is how we end the watch; anything else is a real error.
        if (!(err instanceof Error && err.name === "AbortError")) throw err;
      }
    })();

    // Write a file (parent directories are created as needed), then read it back.
    const { bytesWritten } = await sandbox.files.write("notes/todo.md", "# TODO\n- ship it\n");
    log(`wrote ${bytesWritten} bytes to notes/todo.md`);
    log(`read back: ${JSON.stringify(await sandbox.files.readText("notes/todo.md"))}`);

    // Check that it exists and inspect its metadata.
    log(`exists notes/todo.md → ${await sandbox.files.exists("notes/todo.md")}`);
    const info = await sandbox.files.stat("notes/todo.md");
    log(`stat → ${info.type}, ${info.size} bytes, ${info.permissions}`);

    // Make a directory and move the file into it.
    await sandbox.files.mkdir("archive");
    await sandbox.files.move("notes/todo.md", "archive/todo.md");
    log("moved notes/todo.md → archive/todo.md");

    // List the workspace tree.
    const entries = await sandbox.files.list(".", { recursive: true });
    log(`workspace has ${entries.length} entries:`);
    for (const e of entries) log(`  ${e.type.padEnd(9)} ${e.path}`);

    // Remove what we created (recursive is required for non-empty directories).
    await sandbox.files.remove("archive", { recursive: true });
    await sandbox.files.remove("notes", { recursive: true });
    log("removed archive/ and notes/");

    // Give the watch a moment to report the final removals, then stop it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    stop.abort();
    await watching;
  } finally {
    log("deleting sandbox…");
    await sandbox.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
