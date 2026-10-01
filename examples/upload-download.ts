/**
 * Move a large file into a sandbox and back out.
 *
 * `files.uploadFile` sends a local file in resumable chunks, reading it from disk
 * one chunk at a time, and reports progress as each chunk lands; a chunk that
 * drops in transit resumes from the last byte the sandbox received.
 * `files.downloadFile` streams it back to disk and only puts the file in place once
 * it has fully arrived. Node only.
 *
 * Run (targets the Neev production API by default):
 *   NEEV_API_KEY=... NEEV_ORG_ID=... NEEV_PROJECT_ID=... \
 *     npx tsx examples/upload-download.ts
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Neev } from "@neevcloud/sdk";

// Size of the generated test file: well over the 1 MiB single-request limit.
const SIZE = 24 << 20;

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "neev-upload-"));
  const neev = new Neev();
  const sandbox = await neev.sandboxes.create({
    sandbox_template_id: "sb-ubuntu-24-04-minimal",
  });

  try {
    const local = join(dir, "payload.bin");
    await writeFile(local, randomBytes(SIZE));
    await sandbox.waitUntilReady();

    // Upload in 1 MiB chunks (the default), printing progress after each accepted chunk.
    const { bytesWritten } = await sandbox.files.uploadFile(local, "payload.bin", {
      onProgress: (sent, total) => {
        console.log(`uploaded ${((sent / total) * 100).toFixed(0)}% (${sent}/${total})`);
      },
    });
    console.log(`upload done: ${bytesWritten} bytes`);

    // Download it back and compare sizes.
    const copy = join(dir, "payload.copy.bin");
    const downloaded = await sandbox.files.downloadFile("payload.bin", copy);
    const { size } = await stat(copy);
    console.log(
      `downloaded ${downloaded.bytesWritten} bytes; sizes ${size === SIZE ? "match" : "DIFFER"}`,
    );
  } finally {
    await sandbox.delete();
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
