import { NeevError } from "./errors.js";
import type { ChunkSource } from "./upload.js";

// Node-only helpers that move files between the local disk and a sandbox. node:fs
// is imported on demand so this module stays loadable where it is absent.

type FsPromises = typeof import("node:fs/promises");
type PathModule = typeof import("node:path");

// Loads node:fs/promises and node:path, failing with an actionable error outside Node.
async function loadNodeFs(): Promise<{ fs: FsPromises; path: PathModule }> {
  try {
    const [fs, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
    return { fs, path };
  } catch {
    throw new NeevError("Local file transfer is only available in Node (it requires node:fs).");
  }
}

// An open local file exposed as a ChunkSource, read chunk by chunk from disk.
export interface LocalFileSource extends ChunkSource {
  close(): Promise<void>;
}

// Opens a local file for upload. The caller must close it.
export async function openLocalFile(localPath: string): Promise<LocalFileSource> {
  const { fs } = await loadNodeFs();
  const handle = await fs.open(localPath, "r");
  try {
    const { size } = await handle.stat();
    return {
      size,
      read: async (offset, length) => {
        const buffer = new Uint8Array(length);
        let filled = 0;
        while (filled < length) {
          const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
          if (bytesRead === 0) {
            throw new NeevError(`${localPath} changed size while it was being uploaded.`);
          }
          filled += bytesRead;
        }
        return buffer;
      },
      close: () => handle.close(),
    };
  } catch (err) {
    await handle.close();
    throw err;
  }
}

// Streams a response body to `localPath` via a temporary file in the same directory,
// renamed into place only once the whole body has arrived, so a failed download
// never leaves a partial file. Resolves to the bytes written.
export async function writeBodyToFile(response: Response, localPath: string): Promise<number> {
  const { fs, path } = await loadNodeFs();
  const target = path.resolve(localPath);
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${Math.random().toString(36).slice(2)}.part`,
  );
  const handle = await fs.open(temp, "wx");
  const reader = response.body?.getReader();
  let bytes = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      // write() may write fewer bytes than given, so loop until the chunk is on disk.
      for (let off = 0; off < value.byteLength; ) {
        off += (await handle.write(value, off, value.byteLength - off)).bytesWritten;
      }
      bytes += value.byteLength;
    }
    await handle.close();
    await fs.rename(temp, target);
    return bytes;
  } catch (err) {
    await reader?.cancel().catch(() => undefined);
    await handle.close().catch(() => undefined);
    await fs.rm(temp, { force: true });
    throw err;
  }
}
