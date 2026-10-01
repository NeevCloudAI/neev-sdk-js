import { encodeBase64 } from "./base64.js";
import { APIConnectionError, NeevError, NotFoundError, errorFromSandboxBody } from "./errors.js";
import type { SandboxConnection } from "./runtime.js";

// Resumable (tus 1.0.0) file upload to a sandbox: the file is sent in chunks, and a
// dropped chunk continues from the last byte the sandbox received.

// The largest request body the sandbox accepts, and so the default chunk size. A
// write larger than this goes through the resumable upload.
export const MAX_SINGLE_WRITE_BYTES = 1 << 20;
// Bounds on a caller-chosen chunk size. A chunk is one request, so it can be no
// larger than a single request body; smaller chunks lose less on a flaky link.
const MIN_CHUNK_SIZE = 64 << 10;
const MAX_CHUNK_SIZE = MAX_SINGLE_WRITE_BYTES;
// Consecutive chunk attempts that may fail without the upload advancing before
// the upload gives up.
const MAX_STALLED_ATTEMPTS = 5;
// tus protocol version sent on every upload request.
const TUS_VERSION = "1.0.0";
// Retryable statuses on a chunk: the offset no longer matches (409) or a transient
// server-side failure. Anything else ends the upload.
const RETRYABLE_STATUSES = new Set([409, 500, 502, 503, 504]);

// Options for a resumable upload.
export interface UploadOptions {
  // Chunk size in bytes, 64 KiB to 1 MiB. Defaults to 1 MiB.
  chunkSize?: number;
  // Working directory the path is resolved against, if relative.
  cwd?: string;
  // Called after each chunk the sandbox accepts, with the bytes received so far.
  onProgress?: (bytesSent: number, totalBytes: number) => void;
  // Caller cancellation signal.
  signal?: AbortSignal;
}

// Random-access source of the bytes to upload, read one chunk at a time so a large
// local file is never held in memory whole.
export interface ChunkSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

// Signals that the sandbox has no resumable-upload route, so the caller should
// fall back to a single-request write.
export const UPLOAD_UNSUPPORTED = Symbol("upload-unsupported");

// Validates a caller-chosen chunk size, returning the effective one.
export function resolveChunkSize(chunkSize: number | undefined): number {
  const size = chunkSize ?? MAX_CHUNK_SIZE;
  if (!Number.isInteger(size) || size < MIN_CHUNK_SIZE || size > MAX_CHUNK_SIZE) {
    throw new NeevError(
      `upload: chunkSize must be an integer between ${MIN_CHUNK_SIZE} and ${MAX_CHUNK_SIZE} bytes (got ${chunkSize}).`,
    );
  }
  return size;
}

// Uploads `source` to `path` in chunks and resolves to the bytes written, or to
// UPLOAD_UNSUPPORTED when the sandbox has no resumable-upload route. A failed
// chunk resumes from the offset the sandbox reports; any failure after the upload
// is created cancels it (best effort) before the error is thrown.
export async function resumableUpload(
  conn: SandboxConnection,
  path: string,
  source: ChunkSource,
  options: UploadOptions,
): Promise<number | typeof UPLOAD_UNSUPPORTED> {
  const chunkSize = resolveChunkSize(options.chunkSize);
  const id = await createUpload(conn, path, source.size, options);
  if (id === UPLOAD_UNSUPPORTED) return id;
  try {
    await sendChunks(conn, id, source, chunkSize, options);
    return source.size;
  } catch (err) {
    await abortUpload(conn, id);
    throw err;
  }
}

// Starts the upload and returns its id, taken from the Location header the sandbox
// answers with. A 404 without the sandbox's error envelope means the route itself
// is missing, which is reported as UPLOAD_UNSUPPORTED.
async function createUpload(
  conn: SandboxConnection,
  path: string,
  size: number,
  options: UploadOptions,
): Promise<string | typeof UPLOAD_UNSUPPORTED> {
  const metadata = [`path ${encodeBase64(path)}`];
  if (options.cwd !== undefined) metadata.push(`cwd ${encodeBase64(options.cwd)}`);
  const response = await conn.send({
    method: "POST",
    path: "/v1/files/uploads",
    headers: {
      "tus-resumable": TUS_VERSION,
      "upload-length": String(size),
      "upload-metadata": metadata.join(","),
    },
    signal: options.signal,
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404 && !hasErrorEnvelope(text)) return UPLOAD_UNSUPPORTED;
    throw errorFromSandboxBody(response.status, text, requestId(response));
  }
  const location = response.headers.get("location") ?? "";
  const id = location.split("/").filter(Boolean).pop();
  if (!id) throw new NeevError("upload: the sandbox started the upload without a Location.");
  return id;
}

// Sends every chunk from offset 0, treating the sandbox's Upload-Offset as
// authoritative. A transport error or retryable status asks the sandbox for its
// offset and continues from there; MAX_STALLED_ATTEMPTS such failures in a row
// without progress end the upload.
async function sendChunks(
  conn: SandboxConnection,
  id: string,
  source: ChunkSource,
  chunkSize: number,
  options: UploadOptions,
): Promise<void> {
  let offset = 0;
  let stalled = 0;
  while (offset < source.size) {
    const length = Math.min(chunkSize, source.size - offset);
    const chunk = await source.read(offset, length);
    const outcome = await sendChunk(conn, id, offset, chunk, source.size, options);
    if (typeof outcome === "number") {
      // A chunk that is accepted but does not move the offset would loop forever.
      if (outcome <= offset) {
        throw new NeevError(`upload: the sandbox did not advance past byte ${offset}.`);
      }
      offset = outcome;
      stalled = 0;
      options.onProgress?.(offset, source.size);
      continue;
    }
    stalled++;
    if (stalled >= MAX_STALLED_ATTEMPTS) throw outcome;
    const isLast = offset + length >= source.size;
    let resumed: number;
    try {
      resumed = await uploadOffset(conn, id, options.signal);
    } catch (err) {
      // A final chunk that landed but lost its response leaves no upload to query.
      if (isLast && err instanceof NotFoundError) {
        options.onProgress?.(source.size, source.size);
        return;
      }
      throw outcome;
    }
    if (resumed > source.size) {
      throw new NeevError(
        `upload: the sandbox reported ${resumed} bytes of a ${source.size}-byte upload.`,
      );
    }
    if (resumed > offset) stalled = 0;
    offset = resumed;
  }
}

// Sends one chunk and returns the sandbox's new offset, or the retryable error to
// resume from. Non-retryable failures — including the final chunk being refused
// with the sandbox's error envelope, which means the file could not be written —
// are thrown.
async function sendChunk(
  conn: SandboxConnection,
  id: string,
  offset: number,
  chunk: Uint8Array,
  size: number,
  options: UploadOptions,
): Promise<number | Error> {
  let response: Response;
  try {
    response = await conn.send({
      method: "PATCH",
      path: `/v1/files/uploads/${encodeURIComponent(id)}`,
      headers: {
        "tus-resumable": TUS_VERSION,
        "upload-offset": String(offset),
        "content-type": "application/offset+octet-stream",
      },
      body: chunk,
      signal: options.signal,
    });
  } catch (err) {
    if (options.signal?.aborted || !(err instanceof APIConnectionError)) throw err;
    return err;
  }
  if (response.ok) return readOffset(response);
  const text = await response.text();
  const error = errorFromSandboxBody(response.status, text, requestId(response));
  const isLast = offset + chunk.byteLength >= size;
  if (response.status === 500 && isLast && hasErrorEnvelope(text)) throw error;
  if (!RETRYABLE_STATUSES.has(response.status)) throw error;
  return error;
}

// Asks the sandbox how many bytes of the upload it has received.
async function uploadOffset(
  conn: SandboxConnection,
  id: string,
  signal: AbortSignal | undefined,
): Promise<number> {
  const response = await conn.request({
    method: "HEAD",
    path: `/v1/files/uploads/${encodeURIComponent(id)}`,
    headers: { "tus-resumable": TUS_VERSION },
    signal,
  });
  return readOffset(response);
}

// Cancels an upload, ignoring any failure: it runs only on the way out of an
// upload that has already failed.
async function abortUpload(conn: SandboxConnection, id: string): Promise<void> {
  try {
    await conn.send({
      method: "DELETE",
      path: `/v1/files/uploads/${encodeURIComponent(id)}`,
      headers: { "tus-resumable": TUS_VERSION },
    });
  } catch {
    // Best effort; the sandbox reclaims an abandoned upload on its own.
  }
}

// Parses the Upload-Offset response header, throwing when it is missing or invalid.
function readOffset(response: Response): number {
  const value = Number(response.headers.get("upload-offset"));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NeevError("upload: the sandbox answered without a valid Upload-Offset.");
  }
  return value;
}

// Reports whether a response body is the sandbox's {reason_code, message} envelope.
function hasErrorEnvelope(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { reason_code?: unknown };
    return typeof parsed?.reason_code === "string";
  } catch {
    return false;
  }
}

// Extracts the x-request-id response header for support correlation.
function requestId(response: Response): string | undefined {
  return response.headers.get("x-request-id") ?? undefined;
}

// Wraps in-memory bytes as a ChunkSource.
export function bytesSource(bytes: Uint8Array): ChunkSource {
  return {
    size: bytes.byteLength,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  };
}

// Wraps a Blob as a ChunkSource, reading each chunk on demand.
export function blobSource(blob: Blob): ChunkSource {
  return {
    size: blob.size,
    read: async (offset, length) =>
      new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}
