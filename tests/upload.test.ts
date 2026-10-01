import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InternalServerError, Neev, NeevError, NotFoundError } from "../src/index.js";
import { json, mockFetch, sandboxData } from "./helpers.js";

const BASE = "https://sbx.sandboxes.example";
const MiB = 1 << 20;

// Builds a client and a Ready sandbox handle, queueing the create response plus the
// sandbox responses the test needs after it.
async function readySandbox(queue: Array<Response | Error>) {
  const mock = mockFetch([json(201, sandboxData({ connect_url: BASE, phase: "Ready" })), ...queue]);
  const neev = new Neev({ apiKey: "k", orgId: "o", projectId: "p", fetch: mock.fetch });
  const sandbox = await neev.sandboxes.create({ name: "demo" });
  // Drop the create call so indexes line up with the sandbox calls.
  const calls = mock.calls;
  calls.shift();
  return { sandbox, calls };
}

// A 201 answer to an upload create, pointing at upload `id`.
function created(id = "up1"): Response {
  return new Response(null, { status: 201, headers: { location: `/v1/files/uploads/${id}` } });
}

// A 204 answer to a chunk (or a 200 answer to a HEAD) reporting the received offset.
function offset(value: number, status = 204): Response {
  return new Response(null, { status, headers: { "upload-offset": String(value) } });
}

// Deterministic bytes of the given length.
function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 251;
  return out;
}

// Decodes one base64 Upload-Metadata value.
function metadata(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (header ?? "").split(",")) {
    const [key, value] = pair.split(" ");
    if (key) out[key] = atob(value ?? "");
  }
  return out;
}

describe("files.upload", () => {
  it("creates the upload, then sends each chunk at the server's offset", async () => {
    const data = bytes(2 * MiB + 10);
    const { sandbox, calls } = await readySandbox([
      created(),
      offset(MiB),
      offset(2 * MiB),
      offset(2 * MiB + 10),
    ]);
    const progress: Array<[number, number]> = [];
    const result = await sandbox.files.upload("big.bin", data, {
      cwd: "/work",
      onProgress: (sent, total) => progress.push([sent, total]),
    });

    expect(result).toEqual({ bytesWritten: 2 * MiB + 10 });
    const create = calls[0];
    expect(create?.method).toBe("POST");
    expect(create?.url).toBe(`${BASE}/v1/files/uploads`);
    expect(create?.headers.get("tus-resumable")).toBe("1.0.0");
    expect(create?.headers.get("upload-length")).toBe(String(2 * MiB + 10));
    expect(metadata(create?.headers.get("upload-metadata") ?? null)).toEqual({
      path: "big.bin",
      cwd: "/work",
    });
    expect(create?.headers.get("authorization")).toBe("Bearer k");

    const patches = calls.slice(1);
    expect(patches.map((c) => c.method)).toEqual(["PATCH", "PATCH", "PATCH"]);
    expect(patches.map((c) => c.url)).toEqual(Array(3).fill(`${BASE}/v1/files/uploads/up1`));
    expect(patches.map((c) => c.headers.get("upload-offset"))).toEqual([
      "0",
      String(MiB),
      String(2 * MiB),
    ]);
    expect(patches.map((c) => c.bodyBytes.byteLength)).toEqual([MiB, MiB, 10]);
    expect(patches[0]?.headers.get("content-type")).toBe("application/offset+octet-stream");
    expect(patches[2]?.bodyBytes).toEqual(data.subarray(2 * MiB));
    expect(progress).toEqual([
      [MiB, 2 * MiB + 10],
      [2 * MiB, 2 * MiB + 10],
      [2 * MiB + 10, 2 * MiB + 10],
    ]);
  });

  it("resumes from the HEAD offset after a dropped chunk", async () => {
    const data = bytes(2 * MiB);
    const { sandbox, calls } = await readySandbox([
      created(),
      offset(MiB),
      new TypeError("socket hang up"), // second chunk dropped in transit
      offset(MiB + 100, 200), // HEAD: part of it landed
      offset(2 * MiB),
    ]);
    await sandbox.files.upload("f.bin", data);

    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "PATCH", "HEAD", "PATCH"]);
    expect(calls[3]?.headers.get("tus-resumable")).toBe("1.0.0");
    expect(calls[4]?.headers.get("upload-offset")).toBe(String(MiB + 100));
    expect(calls[4]?.bodyBytes).toEqual(data.subarray(MiB + 100));
  });

  it("treats a 404 on HEAD after a dropped final chunk as written", async () => {
    const data = bytes(MiB + 10);
    const { sandbox, calls } = await readySandbox([
      created(),
      offset(MiB),
      new TypeError("socket hang up"), // final chunk applied, response lost
      new Response(null, { status: 404 }), // HEAD: the upload was already committed
    ]);
    const progress: Array<[number, number]> = [];
    const result = await sandbox.files.upload("f.bin", data, {
      onProgress: (s, t) => progress.push([s, t]),
    });
    expect(result).toEqual({ bytesWritten: MiB + 10 });
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "PATCH", "HEAD"]);
    expect(progress.at(-1)).toEqual([MiB + 10, MiB + 10]);
  });

  it("still fails when HEAD 404s after a dropped chunk that was not the last", async () => {
    const { sandbox, calls } = await readySandbox([
      created(),
      new TypeError("socket hang up"),
      new Response(null, { status: 404 }),
      new Response(null, { status: 204 }), // DELETE
    ]);
    await expect(sandbox.files.upload("f.bin", bytes(MiB + 10))).rejects.toThrow(/failed to reach/);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "HEAD", "DELETE"]);
  });

  it("fails when the sandbox reports more bytes than the upload has", async () => {
    const { sandbox, calls } = await readySandbox([
      created(),
      new TypeError("socket hang up"),
      offset(11, 200),
      new Response(null, { status: 204 }), // DELETE
    ]);
    await expect(sandbox.files.upload("f.bin", bytes(10))).rejects.toThrow(/reported 11 bytes/);
    expect(calls.at(-1)?.method).toBe("DELETE");
  });

  it("re-reads the offset on a 409 and continues from it", async () => {
    const { sandbox, calls } = await readySandbox([
      created(),
      new Response(null, { status: 409 }),
      offset(0, 200),
      offset(10),
    ]);
    await sandbox.files.upload("f.bin", bytes(10));
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "HEAD", "PATCH"]);
    expect(calls[3]?.headers.get("upload-offset")).toBe("0");
  });

  it("gives up and cancels the upload when retries make no progress", async () => {
    const stuck = Array.from({ length: 5 }, () => [
      new Response(null, { status: 503 }),
      offset(0, 200),
    ]).flat();
    const { sandbox, calls } = await readySandbox([
      created(),
      ...stuck.slice(0, -1), // the fifth failure ends it before another HEAD
      new Response(null, { status: 204 }), // DELETE
    ]);
    const err = await sandbox.files.upload("f.bin", bytes(10)).catch((e) => e);
    expect(err).toBeInstanceOf(InternalServerError);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(5);
    const last = calls.at(-1);
    expect(last?.method).toBe("DELETE");
    expect(last?.url).toBe(`${BASE}/v1/files/uploads/up1`);
    expect(last?.headers.get("tus-resumable")).toBe("1.0.0");
  });

  it("errors, rather than loops, when an accepted chunk does not advance the offset", async () => {
    const { sandbox, calls } = await readySandbox([
      created(),
      offset(0),
      new Response(null, { status: 204 }), // DELETE
    ]);
    await expect(sandbox.files.upload("f.bin", bytes(10))).rejects.toThrow(/did not advance/);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "DELETE"]);
  });

  it("throws when the final chunk lands but the file cannot be written", async () => {
    const { sandbox, calls } = await readySandbox([
      created(),
      json(500, { reason_code: "internal", message: "disk full" }),
      new Response(null, { status: 204 }), // DELETE
    ]);
    const err = await sandbox.files.upload("f.bin", bytes(10)).catch((e) => e);
    expect(err).toBeInstanceOf(InternalServerError);
    expect((err as InternalServerError).code).toBe("internal");
    expect((err as InternalServerError).message).toContain("disk full");
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "DELETE"]);
  });

  it("throws a non-retryable chunk refusal straight away", async () => {
    const { sandbox, calls } = await readySandbox([
      created(),
      json(404, { reason_code: "not_found", message: "no such upload" }),
      new Response(null, { status: 204 }),
    ]);
    await expect(sandbox.files.upload("f.bin", bytes(10))).rejects.toBeInstanceOf(NotFoundError);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "DELETE"]);
  });

  it("falls back to a single write when the sandbox has no upload route", async () => {
    const { sandbox, calls } = await readySandbox([
      new Response("404 page not found", { status: 404 }),
      json(200, { bytes_written: 10 }),
    ]);
    const result = await sandbox.files.upload("f.bin", bytes(10));
    expect(result).toEqual({ bytesWritten: 10 });
    expect(calls[1]?.url).toBe(`${BASE}/v1/files/write?path=f.bin`);
    expect(calls[1]?.bodyBytes).toEqual(bytes(10));
  });

  it("does not fall back on a 404 that carries the sandbox's error envelope", async () => {
    const { sandbox, calls } = await readySandbox([
      json(404, { reason_code: "not_found", message: "parent directory missing" }),
    ]);
    await expect(sandbox.files.upload("a/b.bin", bytes(10))).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(1);
  });

  it("writes empty data in a single request", async () => {
    const { sandbox, calls } = await readySandbox([json(200, { bytes_written: 0 })]);
    await sandbox.files.upload("empty", new Uint8Array());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/v1/files/write?path=empty`);
  });

  it("accepts a string, an ArrayBuffer, and a Blob", async () => {
    const { sandbox, calls } = await readySandbox([
      created("a"),
      offset(2),
      created("b"),
      offset(3),
      created("c"),
      offset(4),
    ]);
    await sandbox.files.upload("s", "hi");
    await sandbox.files.upload("ab", new Uint8Array([1, 2, 3]).buffer);
    await sandbox.files.upload("blob", new Blob([new Uint8Array([9, 8, 7, 6])]));
    expect(calls[1]?.bodyBytes).toEqual(new TextEncoder().encode("hi"));
    expect(calls[3]?.bodyBytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[5]?.bodyBytes).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(calls[5]?.headers.get("upload-length")).toBeNull(); // PATCH carries no length
    expect(calls[4]?.headers.get("upload-length")).toBe("4");
  });

  it("rejects a chunk size outside 64 KiB..1 MiB before any request", async () => {
    const { sandbox, calls } = await readySandbox([]);
    await expect(sandbox.files.upload("f", bytes(1), { chunkSize: 64 * 1024 - 1 })).rejects.toThrow(
      NeevError,
    );
    await expect(sandbox.files.upload("f", bytes(1), { chunkSize: MiB + 1 })).rejects.toThrow(
      /chunkSize/,
    );
    expect(calls).toHaveLength(0);
  });

  it("sends chunks of the chosen size", async () => {
    const half = MiB / 2;
    const { sandbox, calls } = await readySandbox([
      created(),
      offset(half),
      offset(MiB),
      offset(MiB + 10),
    ]);
    await sandbox.files.upload("f", bytes(MiB + 10), { chunkSize: half });
    expect(calls.slice(1).map((c) => c.bodyBytes.byteLength)).toEqual([half, half, 10]);
  });
});

describe("files.write size routing", () => {
  it("routes content larger than 1 MiB through the resumable upload", async () => {
    const { sandbox, calls } = await readySandbox([created(), offset(MiB), offset(MiB + 1)]);
    const result = await sandbox.files.write("big", bytes(MiB + 1));
    expect(result).toEqual({ bytesWritten: MiB + 1 });
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "PATCH"]);
    expect(calls[0]?.url).toBe(`${BASE}/v1/files/uploads`);
  });

  it("writes exactly 1 MiB in a single request", async () => {
    const { sandbox, calls } = await readySandbox([json(200, { bytes_written: MiB })]);
    await sandbox.files.write("one", bytes(MiB));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/v1/files/write?path=one`);
  });
});

describe("local file transfer", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "neev-sdk-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("uploadFile reads the local file chunk by chunk", async () => {
    const data = bytes(MiB + 5);
    const local = join(dir, "in.bin");
    await writeFile(local, data);
    const { sandbox, calls } = await readySandbox([created(), offset(MiB), offset(MiB + 5)]);
    const result = await sandbox.files.uploadFile(local, "remote.bin");
    expect(result).toEqual({ bytesWritten: MiB + 5 });
    expect(metadata(calls[0]?.headers.get("upload-metadata") ?? null)).toEqual({
      path: "remote.bin",
    });
    expect(calls[0]?.headers.get("upload-length")).toBe(String(MiB + 5));
    expect(calls[1]?.bodyBytes).toEqual(data.subarray(0, MiB));
    expect(calls[2]?.bodyBytes).toEqual(data.subarray(MiB));
  });

  it("uploadFile rejects a missing local file before any request", async () => {
    const { sandbox, calls } = await readySandbox([]);
    await expect(sandbox.files.uploadFile(join(dir, "nope"), "r")).rejects.toThrow(/ENOENT/);
    expect(calls).toHaveLength(0);
  });

  it("downloadFile streams the file to disk", async () => {
    const data = bytes(300_000);
    const { sandbox, calls } = await readySandbox([
      new Response(data, { status: 200, headers: { "content-type": "application/octet-stream" } }),
    ]);
    const local = join(dir, "out.bin");
    const result = await sandbox.files.downloadFile("remote.bin", local, { cwd: "/work" });
    expect(result).toEqual({ bytesWritten: data.byteLength });
    expect(new Uint8Array(await readFile(local))).toEqual(data);
    expect(calls[0]?.url).toBe(`${BASE}/v1/files/read`);
    expect(calls[0]?.body).toEqual({ path: "remote.bin", cwd: "/work" });
    expect(await readdir(dir)).toEqual(["out.bin"]);
  });

  it("downloadFile leaves no file behind when the body fails mid-stream", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(1000));
        controller.error(new Error("connection reset"));
      },
    });
    const { sandbox } = await readySandbox([new Response(body, { status: 200 })]);
    const local = join(dir, "out.bin");
    await expect(sandbox.files.downloadFile("remote.bin", local)).rejects.toThrow(
      /connection reset/,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it("downloadFile leaves no file behind when the sandbox refuses the read", async () => {
    const { sandbox } = await readySandbox([
      json(404, { reason_code: "not_found", message: "no such file" }),
    ]);
    await expect(
      sandbox.files.downloadFile("missing", join(dir, "out.bin")),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await readdir(dir)).toEqual([]);
  });
});
