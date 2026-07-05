import { describe, expect, it, vi } from "vitest";
import {
  DeadlineExceededError,
  InternalServerError,
  Neev,
  NeevError,
  NotFoundError,
  PermissionDeniedError,
} from "../src/index.js";
import { json, mockFetch, sandboxData } from "./helpers.js";

// Builds a client and a Ready sandbox handle (with a connect_url), queueing the
// create response plus any daemon responses the test needs after it.
async function readySandbox(connectUrl: string | null, daemonQueue: Array<Response | Error>) {
  const mock = mockFetch([
    json(201, sandboxData({ connect_url: connectUrl, phase: "Ready" })),
    ...daemonQueue,
  ]);
  const neev = new Neev({
    apiKey: "k",
    orgId: "org_test",
    projectId: "proj_test",
    fetch: mock.fetch,
  });
  const sandbox = await neev.sandboxes.create({
    name: "demo",
    sandbox_template_id: "sb-ubuntu-26-04-minimal",
  });
  return { sandbox, calls: mock.calls };
}

describe("sandboxd", () => {
  it("throws when a Ready sandbox exposes no connect_url", async () => {
    const { sandbox } = await readySandbox(null, []);
    await expect(sandbox.files.write("/a", "x")).rejects.toThrow(/connect_url/);
  });

  it("waits until Ready to obtain connect_url on first runtime use", async () => {
    vi.useFakeTimers();
    try {
      const mock = mockFetch([
        json(201, sandboxData({ phase: "Pending", connect_url: null })),
        json(200, sandboxData({ phase: "Ready", connect_url: "https://sbx.sandboxes.example" })),
        json(200, { bytes_written: 3 }),
      ]);
      const neev = new Neev({
        apiKey: "k",
        orgId: "org_test",
        projectId: "proj_test",
        fetch: mock.fetch,
      });
      const sandbox = await neev.sandboxes.create({
        name: "demo",
        sandbox_template_id: "sb-ubuntu-26-04-minimal",
      });
      // Kick off a file write while still Pending; it should poll until Ready,
      // then issue the daemon call against the resolved connect_url.
      const write = sandbox.files.write("/a", "abc");
      // Advance one poll interval (DEFAULT_POLL_INTERVAL_MS) so the single
      // waitUntilReady poll fires its refresh and observes the Ready phase.
      await vi.advanceTimersByTimeAsync(2000);
      const result = await write;

      expect(result.bytesWritten).toBe(3);
      expect(mock.calls).toHaveLength(3);
      expect(mock.calls[2]?.url).toBe("https://sbx.sandboxes.example/v1/files/write?path=%2Fa");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuilds the daemon connection when connect_url changes", async () => {
    const mock = mockFetch([
      json(201, sandboxData({ phase: "Ready", connect_url: "https://a.example" })),
      json(200, { bytes_written: 1 }),
      json(200, sandboxData({ phase: "Ready", connect_url: "https://b.example" })),
      json(200, { bytes_written: 1 }),
    ]);
    const neev = new Neev({
      apiKey: "k",
      orgId: "org_test",
      projectId: "proj_test",
      fetch: mock.fetch,
    });
    const sandbox = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    await sandbox.files.write("/a", "x");
    await sandbox.resume();
    await sandbox.files.write("/b", "y");

    expect(mock.calls[1]?.url).toContain("https://a.example/");
    expect(mock.calls[3]?.url).toContain("https://b.example/");
  });

  it("exec also waits until Ready to obtain connect_url on first use", async () => {
    vi.useFakeTimers();
    try {
      // Minimal NDJSON exec stream: a single terminal exit frame.
      const exit = new Response(`${JSON.stringify({ type: "exit", exit_code: 0 })}\n`, {
        status: 200,
      });
      const mock = mockFetch([
        json(201, sandboxData({ phase: "Pending", connect_url: null })),
        json(200, sandboxData({ phase: "Ready", connect_url: "https://sbx.sandboxes.example" })),
        exit,
      ]);
      const neev = new Neev({
        apiKey: "k",
        orgId: "org_test",
        projectId: "proj_test",
        fetch: mock.fetch,
      });
      const sandbox = await neev.sandboxes.create({
        name: "demo",
        sandbox_template_id: "sb-ubuntu-26-04-minimal",
      });
      const run = sandbox.exec(["true"]);
      // Advance one poll interval (DEFAULT_POLL_INTERVAL_MS) to let the readiness
      // poll observe Ready, then the exec hits the resolved connect_url.
      await vi.advanceTimersByTimeAsync(2000);
      const result = await run;

      expect(result.exitCode).toBe(0);
      expect(mock.calls).toHaveLength(3);
      expect(mock.calls[2]?.url).toBe("https://sbx.sandboxes.example/v1/exec");
    } finally {
      vi.useRealTimers();
    }
  });

  describe("files.write", () => {
    it("posts raw content to the connect_url host with bearer auth", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { bytes_written: 11 }),
      ]);
      const result = await sandbox.files.write("/work/a.txt", "hello world");

      expect(result.bytesWritten).toBe(11);
      const call = calls[1];
      expect(call?.method).toBe("POST");
      expect(call?.url).toBe("https://sbx.sandboxes.example/v1/files/write?path=%2Fwork%2Fa.txt");
      expect(call?.headers.get("authorization")).toBe("Bearer k");
      expect(call?.body).toBe("hello world");
    });

    it("includes cwd in the query when provided", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { bytes_written: 1 }),
      ]);
      await sandbox.files.write("a.txt", "x", { cwd: "/work" });
      expect(calls[1]?.url).toContain("cwd=%2Fwork");
    });

    it("maps a daemon error (reason_code/message) to a typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(404, { reason_code: "not_found", message: "no such path" }),
      ]);
      const err = await sandbox.files.write("/missing", "x").catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe("not_found");
      expect((err as NotFoundError).details).toBe("no such path");
    });

    it("does not retry on a 5xx", async () => {
      // Only one 5xx is queued; a retry would consume a second (absent) response
      // and throw a different error, so a clean InternalServerError proves no retry.
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(503, { reason_code: "unavailable", message: "down" }),
      ]);
      await expect(sandbox.files.write("/a", "b")).rejects.toBeInstanceOf(InternalServerError);
    });

    it("sends a Uint8Array body as raw octet-stream bytes", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { bytes_written: 4 }),
      ]);
      await sandbox.files.write("/b.bin", new Uint8Array([0, 1, 2, 255]));
      expect(Array.from(calls[1]?.bodyBytes ?? [])).toEqual([0, 1, 2, 255]);
      expect(calls[1]?.headers.get("content-type")).toBe("application/octet-stream");
    });

    it("maps a non-JSON error body to details", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        new Response("Bad Gateway", { status: 502 }),
      ]);
      const err = await sandbox.files.write("/a", "b").catch((e) => e);
      expect(err).toBeInstanceOf(InternalServerError);
      expect((err as InternalServerError).details).toBe("Bad Gateway");
    });
  });

  describe("connection", () => {
    it("reuses a single daemon connection across calls", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { bytes_written: 1 }),
        json(200, { bytes_written: 1 }),
      ]);
      await sandbox.files.write("/a", "x");
      await sandbox.files.write("/b", "y");
      expect(calls[1]?.url).toContain("https://sbx.sandboxes.example/");
      expect(calls[2]?.url).toContain("https://sbx.sandboxes.example/");
    });
  });

  describe("files.read", () => {
    it("posts the path and returns raw bytes", async () => {
      const bytes = new Uint8Array([1, 2, 3, 255]);
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        new Response(bytes, { status: 200 }),
      ]);
      const out = await sandbox.files.read("/work/data.bin", { cwd: "/work" });

      expect(Array.from(out)).toEqual([1, 2, 3, 255]);
      const call = calls[1];
      expect(call?.method).toBe("POST");
      expect(call?.url).toBe("https://sbx.sandboxes.example/v1/files/read");
      expect(call?.body).toEqual({ path: "/work/data.bin", cwd: "/work" });
    });

    it("readText decodes the bytes as UTF-8", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        new Response("héllo", { status: 200 }),
      ]);
      const text = await sandbox.files.readText("/work/a.txt");
      expect(text).toBe("héllo");
    });

    it("maps a read error to a typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(404, { reason_code: "not_found", message: "missing" }),
      ]);
      await expect(sandbox.files.read("/missing")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("files.list", () => {
    it("lists entries and maps them to camelCase", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, {
          entries: [
            {
              name: "a.txt",
              type: "file",
              path: "work/a.txt",
              size: 12,
              mode: 420,
              permissions: "rw-r--r--",
              modified_time: "2026-06-05T00:00:00Z",
            },
            {
              name: "link",
              type: "symlink",
              path: "work/link",
              size: 0,
              mode: 511,
              permissions: "rwxrwxrwx",
              modified_time: "2026-06-05T00:00:00Z",
              symlink_target: "a.txt",
            },
          ],
        }),
      ]);
      const entries = await sandbox.files.list("/work", { recursive: true, maxCount: 50 });

      expect(entries).toHaveLength(2);
      expect(entries[0]?.modifiedTime).toBe("2026-06-05T00:00:00Z");
      expect(entries[1]?.symlinkTarget).toBe("a.txt");
      const call = calls[1];
      expect(call?.url).toBe("https://sbx.sandboxes.example/v1/files/list");
      expect(call?.body).toEqual({
        path: "/work",
        recursive: true,
        max_count: 50,
      });
    });

    it("maps a list error to a typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(403, { reason_code: "permission_denied", message: "nope" }),
      ]);
      await expect(sandbox.files.list("/work")).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  describe("files control ops", () => {
    const entry = {
      name: "a.txt",
      type: "file" as const,
      path: "work/a.txt",
      size: 3,
      mode: 420,
      permissions: "rw-r--r--",
      modified_time: "2026-06-05T00:00:00Z",
    };

    it("stat returns the entry mapped to camelCase", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { entry }),
      ]);
      const got = await sandbox.files.stat("a.txt", { cwd: "/work" });
      expect(got.modifiedTime).toBe("2026-06-05T00:00:00Z");
      expect(calls[1]?.url).toBe("https://sbx.sandboxes.example/v1/files/stat");
      expect(calls[1]?.body).toEqual({ path: "a.txt", cwd: "/work" });
    });

    it("exists returns the boolean", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { exists: false }),
      ]);
      expect(await sandbox.files.exists("/nope")).toBe(false);
      expect(calls[1]?.url).toBe("https://sbx.sandboxes.example/v1/files/exists");
    });

    it("mkdir returns the created directory entry", async () => {
      const dir = { ...entry, name: "d", type: "directory" as const, path: "work/d" };
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { entry: dir }),
      ]);
      const got = await sandbox.files.mkdir("d", { cwd: "/work" });
      expect(got.type).toBe("directory");
      expect(calls[1]?.url).toBe("https://sbx.sandboxes.example/v1/files/mkdir");
    });

    it("remove posts recursive and resolves void", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { removed: true }),
      ]);
      await expect(sandbox.files.remove("/work/d", { recursive: true })).resolves.toBeUndefined();
      expect(calls[1]?.url).toBe("https://sbx.sandboxes.example/v1/files/remove");
      expect(calls[1]?.body).toEqual({ path: "/work/d", recursive: true });
    });

    it("move posts source/destination and returns the moved entry", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        json(200, { entry: { ...entry, path: "work/b.txt", name: "b.txt" } }),
      ]);
      const got = await sandbox.files.move("a.txt", "b.txt", { cwd: "/work" });
      expect(got.name).toBe("b.txt");
      expect(calls[1]?.url).toBe("https://sbx.sandboxes.example/v1/files/move");
      expect(calls[1]?.body).toEqual({ source: "a.txt", destination: "b.txt", cwd: "/work" });
    });

    it("maps a control-op error to a typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(404, { reason_code: "not_found", message: "no" }),
      ]);
      await expect(sandbox.files.stat("/missing")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("files.watch", () => {
    // Builds an NDJSON watch stream Response from event frames.
    function ndjson(frames: unknown[]): Response {
      return new Response(frames.map((f) => JSON.stringify(f)).join("\n"), { status: 200 });
    }

    it("streams change events, mapping entries to camelCase", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          {
            type: "create",
            path: "a.txt",
            entry: {
              name: "a.txt",
              type: "file",
              path: "a.txt",
              size: 1,
              mode: 420,
              permissions: "rw-r--r--",
              modified_time: "2026-06-05T00:00:00Z",
            },
          },
          { type: "remove", path: "a.txt" },
        ]),
      ]);

      const events = [];
      for await (const ev of sandbox.files.watch(".", { recursive: true, timeoutMs: 2500 })) {
        events.push(ev);
      }
      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("create");
      expect(events[0]?.entry?.modifiedTime).toBe("2026-06-05T00:00:00Z");
      expect(events[1]).toEqual({ type: "remove", path: "a.txt", entry: undefined });
      expect(calls[1]?.url).toBe("https://sbx.sandboxes.example/v1/files/watch");
      expect(calls[1]?.body).toEqual({ path: ".", recursive: true, timeout_ms: 2500 });
    });

    it("reassembles frames split across stream chunks", async () => {
      // Two chunks that split the first frame mid-line, exercising the line buffer.
      const chunks = ['{"type":"create","path":"a', '.txt"}\n{"type":"remove","path":"a.txt"}\n'];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          for (const c of chunks) controller.enqueue(enc.encode(c));
          controller.close();
        },
      });
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        new Response(stream, { status: 200 }),
      ]);

      const seen = [];
      for await (const ev of sandbox.files.watch(".")) {
        seen.push(`${ev.type}:${ev.path}`);
      }
      expect(seen).toEqual(["create:a.txt", "remove:a.txt"]);
    });

    it("throws before the first event on a bad path", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        json(400, { reason_code: "invalid_argument", message: "not a directory" }),
      ]);
      const iter = sandbox.files.watch("/file.txt");
      await expect(iter.next()).rejects.toBeInstanceOf(NeevError);
    });
  });

  describe("exec", () => {
    // Builds an NDJSON exec stream Response from frame objects.
    function ndjson(frames: unknown[]): Response {
      const text = frames.map((f) => JSON.stringify(f)).join("\n");
      return new Response(text, { status: 200 });
    }

    it("drains the NDJSON stream into buffered stdout/stderr/exitCode", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stdout", data: btoa("hello ") },
          { type: "stderr", data: btoa("warn") },
          { type: "stdout", data: btoa("world") },
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const result = await sandbox.exec("echo", { args: ["hi"] });

      expect(result.stdout).toBe("hello world");
      expect(result.stderr).toBe("warn");
      expect(result.exitCode).toBe(0);
      const call = calls[1];
      expect(call?.url).toBe("https://sbx.sandboxes.example/v1/exec");
      expect(call?.body).toEqual({ command: "echo", args: ["hi"] });
    });

    it("maps an argv array to command + args", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "exit", exit_code: 0 }]),
      ]);
      await sandbox.exec(["python", "/work/x.py"]);
      expect(calls[1]?.body).toEqual({ command: "python", args: ["/work/x.py"] });
    });

    it("returns a non-zero exit code without throwing", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stderr", data: btoa("boom") },
          { type: "exit", exit_code: 2 },
        ]),
      ]);
      const result = await sandbox.exec("false");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe("boom");
    });

    it("maps a terminal error frame to the matching typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stdout", data: btoa("partial") },
          { type: "error", reason_code: "deadline_exceeded", message: "timed out" },
        ]),
      ]);
      const err = await sandbox.exec("sleep", { args: ["999"] }).catch((e) => e);
      expect(err).toBeInstanceOf(DeadlineExceededError);
      expect((err as DeadlineExceededError).details).toBe("timed out");
    });

    it("maps a non-5xx error frame to its typed error", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "error", reason_code: "permission_denied", message: "denied" }]),
      ]);
      await expect(sandbox.exec("whoami")).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("maps the env record to a K=V array on the wire", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "exit", exit_code: 0 }]),
      ]);
      await sandbox.exec("env", { env: { FOO: "bar", BAZ: "qux" } });
      expect((calls[1]?.body as { env: string[] }).env).toEqual(["FOO=bar", "BAZ=qux"]);
    });

    it("returns empty output when no stdout/stderr frames arrive", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "exit", exit_code: 0 }]),
      ]);
      const result = await sandbox.exec("true");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });

    it("decodes a multi-byte UTF-8 char split across two frames", async () => {
      // "é" is 0xC3 0xA9; deliver each byte in a separate stdout frame.
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stdout", data: btoa(String.fromCharCode(0xc3)) },
          { type: "stdout", data: btoa(String.fromCharCode(0xa9)) },
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const result = await sandbox.exec("printf");
      expect(result.stdout).toBe("é");
    });

    it("throws when the stream ends without an exit frame", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "stdout", data: btoa("partial") }]),
      ]);
      await expect(sandbox.exec("sleep")).rejects.toThrow(/exit status/);
    });

    it("throws when args are given both in the argv array and options.args", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", []);
      await expect(sandbox.exec(["git", "status"], { args: ["-s"] })).rejects.toBeInstanceOf(
        NeevError,
      );
    });

    it("execStream yields incremental stdout/stderr/exit events", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stdout", data: btoa("hello ") },
          { type: "stdout", data: btoa("world") },
          { type: "stderr", data: btoa("warn") },
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const events = [];
      for await (const ev of sandbox.execStream("echo", { args: ["hi"] })) events.push(ev);
      expect(events).toEqual([
        { type: "stdout", data: "hello " },
        { type: "stdout", data: "world" },
        { type: "stderr", data: "warn" },
        { type: "exit", exitCode: 0 },
      ]);
      expect(calls[1]?.url).toBe("https://sbx.sandboxes.example/v1/exec");
    });

    it("exec with { stream: true } yields events instead of buffering", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stdout", data: btoa("a") },
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const events = [];
      for await (const ev of sandbox.exec("echo", { stream: true })) events.push(ev);
      expect(events).toEqual([
        { type: "stdout", data: "a" },
        { type: "exit", exitCode: 0 },
      ]);
    });

    it("execStream decodes a multi-byte char split across frames", async () => {
      // "é" is 0xC3 0xA9; deliver each byte in its own stdout frame.
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([
          { type: "stdout", data: btoa(String.fromCharCode(0xc3)) },
          { type: "stdout", data: btoa(String.fromCharCode(0xa9)) },
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const out = [];
      for await (const ev of sandbox.execStream("printf")) {
        if (ev.type === "stdout") out.push(ev.data);
      }
      expect(out.join("")).toBe("é");
    });

    it("execStream throws a typed error on a terminal error frame", async () => {
      const { sandbox } = await readySandbox("https://sbx.sandboxes.example", [
        ndjson([{ type: "error", reason_code: "permission_denied", message: "denied" }]),
      ]);
      const drain = async () => {
        const seen = [];
        for await (const ev of sandbox.execStream("whoami")) seen.push(ev);
        return seen;
      };
      await expect(drain()).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });
});
