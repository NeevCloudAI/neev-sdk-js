import { describe, expect, it, vi } from "vitest";
import { Neev, NotFoundError, Signal } from "../src/index.js";
import { json, mockFetch, sandboxData } from "./helpers.js";

// Builds a client and a Ready sandbox handle (with a connect_url), queueing the
// create response plus any daemon responses the test needs after it.
async function readySandbox(connectUrl: string, daemonQueue: Array<Response | Error>) {
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

// Builds an NDJSON follow Response from a list of frames.
function ndjson(frames: unknown[]): Response {
  const text = frames.map((f) => JSON.stringify(f)).join("\n");
  return new Response(text, { status: 200 });
}

// Base64-encodes raw bytes (for follow-frame data, which is base64 on the wire).
function b64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("processes", () => {
  describe("start", () => {
    it("posts program/args/cwd/env/stdin and returns a Process snapshot", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { process_id: "proc_1", state: "running", exit_code: null, started_at: 1700 }),
      ]);
      const proc = await sandbox.processes.start("npm", {
        args: ["run", "dev"],
        cwd: "app",
        env: { NODE_ENV: "development" },
        stdin: "hi",
      });

      expect(proc.id).toBe("proc_1");
      expect(proc.state).toBe("running");
      expect(proc.exitCode).toBeNull();
      expect(proc.startedAt).toBe(1700);

      const call = calls[1];
      expect(call?.method).toBe("POST");
      expect(call?.url).toBe("https://sbx.example/v1/processes/start");
      expect(call?.headers.get("authorization")).toBe("Bearer k");
      expect(call?.body).toEqual({
        program: "npm",
        args: ["run", "dev"],
        cwd: "app",
        env: ["NODE_ENV=development"],
        stdin: "hi",
      });
    });

    it("accepts a full argv array", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { process_id: "proc_2", state: "running", exit_code: null, started_at: 1 }),
      ]);
      await sandbox.processes.start(["sh", "-c", "echo hi"]);
      expect(calls[1]?.body).toEqual({ program: "sh", args: ["-c", "echo hi"] });
    });

    it("sends an empty args array for a bare program name", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { process_id: "proc_4", state: "running", exit_code: null, started_at: 1 }),
      ]);
      await sandbox.processes.start("sh");
      expect(calls[1]?.body).toEqual({ program: "sh", args: [] });
    });

    it("throws when given both an argv array and options.args", async () => {
      const { sandbox } = await readySandbox("https://sbx.example", []);
      await expect(sandbox.processes.start(["sh"], { args: ["-c"] })).rejects.toThrow(/not both/);
    });

    it("throws on an empty program", async () => {
      const { sandbox } = await readySandbox("https://sbx.example", []);
      await expect(sandbox.processes.start("")).rejects.toThrow(/non-empty program/);
      await expect(sandbox.processes.start([])).rejects.toThrow(/non-empty program/);
    });

    it("waits until Ready to obtain connect_url on first use", async () => {
      vi.useFakeTimers();
      try {
        const mock = mockFetch([
          json(201, sandboxData({ phase: "Pending", connect_url: null })),
          json(200, sandboxData({ phase: "Ready", connect_url: "https://sbx.example" })),
          json(200, { process_id: "proc_3", state: "running", exit_code: null, started_at: 1 }),
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
        const starting = sandbox.processes.start("sleep", { args: ["1"] });
        await vi.advanceTimersByTimeAsync(2000);
        const proc = await starting;

        expect(proc.id).toBe("proc_3");
        expect(mock.calls).toHaveLength(3);
        expect(mock.calls[2]?.url).toBe("https://sbx.example/v1/processes/start");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("get / status / wait", () => {
    it("get without wait reports a running process", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { process_id: "proc_1", state: "running", exit_code: null, started_at: 5 }),
      ]);
      const status = await sandbox.processes.get("proc_1");
      expect(status).toEqual({
        processId: "proc_1",
        state: "running",
        exitCode: null,
        startedAt: 5,
      });
      expect(calls[1]?.url).toBe("https://sbx.example/v1/processes/get");
      expect(calls[1]?.body).toEqual({ process_id: "proc_1" });
    });

    it("Process.wait blocks (wait:true) and caches the terminal status", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { process_id: "proc_1", state: "running", exit_code: null, started_at: 5 }),
        json(200, { process_id: "proc_1", state: "exited", exit_code: 0, started_at: 5 }),
      ]);
      const proc = await sandbox.processes.start("sh");
      const status = await proc.wait();

      expect(status).toEqual({
        processId: "proc_1",
        state: "exited",
        exitCode: 0,
        startedAt: 5,
      });
      // The handle snapshot is updated by wait().
      expect(proc.state).toBe("exited");
      expect(proc.exitCode).toBe(0);
      expect(calls[2]?.body).toEqual({ process_id: "proc_1", wait: true });
    });

    it("Process.status refreshes without blocking", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { process_id: "proc_1", state: "running", exit_code: null, started_at: 5 }),
        json(200, { process_id: "proc_1", state: "exited", exit_code: 3, started_at: 5 }),
      ]);
      const proc = await sandbox.processes.start("sh");
      const status = await proc.status();
      expect(status.exitCode).toBe(3);
      expect(proc.exitCode).toBe(3);
      // status() must not set wait.
      expect(calls[2]?.body).toEqual({ process_id: "proc_1" });
    });

    it("maps a 404 to NotFoundError", async () => {
      const { sandbox } = await readySandbox("https://sbx.example", [
        json(404, { reason_code: "not_found", message: "no such process" }),
      ]);
      await expect(sandbox.processes.get("proc_missing")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("list", () => {
    it("maps snake_case records to camelCase ProcessInfo", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, {
          processes: [
            {
              process_id: "proc_1",
              name: "npm",
              args: ["run", "dev"],
              cwd: "app",
              state: "running",
              exit_code: null,
              started_at: 10,
            },
          ],
        }),
      ]);
      const list = await sandbox.processes.list();
      expect(list).toEqual([
        {
          processId: "proc_1",
          name: "npm",
          args: ["run", "dev"],
          cwd: "app",
          state: "running",
          exitCode: null,
          startedAt: 10,
        },
      ]);
      expect(calls[1]?.url).toBe("https://sbx.example/v1/processes/list");
    });

    it("returns an empty array when no processes are tracked", async () => {
      const { sandbox } = await readySandbox("https://sbx.example", [json(200, { processes: [] })]);
      expect(await sandbox.processes.list()).toEqual([]);
    });
  });

  describe("kill / killAll", () => {
    it("kill defaults the signal (omitted) and returns signalled", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { process_id: "proc_1", signalled: true }),
      ]);
      expect(await sandbox.processes.kill("proc_1")).toBe(true);
      expect(calls[1]?.url).toBe("https://sbx.example/v1/processes/kill");
      expect(calls[1]?.body).toEqual({ process_id: "proc_1" });
    });

    it("kill forwards an explicit signal", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { process_id: "proc_1", signalled: false }),
      ]);
      expect(await sandbox.processes.kill("proc_1", Signal.KILL)).toBe(false);
      expect(calls[1]?.body).toEqual({ process_id: "proc_1", signal: 9 });
    });

    it("Process.kill delegates to the supervisor", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { process_id: "proc_1", state: "running", exit_code: null, started_at: 1 }),
        json(200, { process_id: "proc_1", signalled: true }),
      ]);
      const proc = await sandbox.processes.start("sh");
      expect(await proc.kill(Signal.TERM)).toBe(true);
      expect(calls[2]?.body).toEqual({ process_id: "proc_1", signal: 15 });
    });

    it("killAll returns the signalled count", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { signalled_count: 3 }),
      ]);
      expect(await sandbox.processes.killAll()).toBe(3);
      expect(calls[1]?.url).toBe("https://sbx.example/v1/processes/kill-all");
      expect(calls[1]?.body).toEqual({});
    });

    it("killAll forwards an explicit signal", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, { signalled_count: 1 }),
      ]);
      await sandbox.processes.killAll(Signal.INT);
      expect(calls[1]?.body).toEqual({ signal: 2 });
    });
  });

  describe("logs (poll)", () => {
    it("returns UTF-8 entries with cursor/dropped/state", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        json(200, {
          entries: [
            { stream: "stdout", data: "installing…\n" },
            { stream: "stderr", data: "warn: deprecated\n" },
          ],
          cursor: 4096,
          dropped: false,
          state: "running",
        }),
      ]);
      const page = await sandbox.processes.logs("proc_1", { cursor: 0 });
      expect(page.entries).toEqual([
        { stream: "stdout", data: "installing…\n" },
        { stream: "stderr", data: "warn: deprecated\n" },
      ]);
      expect(page.cursor).toBe(4096);
      expect(page.dropped).toBe(false);
      expect(page.state).toBe("running");
      expect(calls[1]?.body).toEqual({ process_id: "proc_1", cursor: 0 });
    });

    it("surfaces dropped:true and an empty page", async () => {
      const { sandbox } = await readySandbox("https://sbx.example", [
        json(200, { entries: [], cursor: 8192, dropped: true, state: "exited" }),
      ]);
      const page = await sandbox.processes.logs("proc_1", { cursor: 1 });
      expect(page.entries).toEqual([]);
      expect(page.dropped).toBe(true);
      expect(page.state).toBe("exited");
    });
  });

  describe("follow", () => {
    it("decodes base64 stdout/stderr and yields a terminal exit event", async () => {
      const { sandbox, calls } = await readySandbox("https://sbx.example", [
        ndjson([
          { type: "stdout", data: btoa("hello ") },
          { type: "stderr", data: btoa("warn") },
          { type: "stdout", data: btoa("world") },
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const events = [];
      for await (const ev of sandbox.processes.follow("proc_1")) events.push(ev);

      expect(events).toEqual([
        { type: "stdout", data: "hello " },
        { type: "stderr", data: "warn" },
        { type: "stdout", data: "world" },
        { type: "exit", exitCode: 0 },
      ]);
      expect(calls[1]?.url).toBe("https://sbx.example/v1/processes/logs");
      expect(calls[1]?.body).toEqual({ process_id: "proc_1", cursor: undefined, follow: true });
      expect(calls[1]?.headers.get("accept")).toBe("application/x-ndjson");
    });

    it("carries a non-zero exit code on the terminal event", async () => {
      const { sandbox } = await readySandbox("https://sbx.example", [
        ndjson([
          { type: "stdout", data: btoa("boom\n") },
          { type: "exit", exit_code: 137 },
        ]),
      ]);
      const events = [];
      for await (const ev of sandbox.processes.follow("proc_1")) events.push(ev);
      expect(events.at(-1)).toEqual({ type: "exit", exitCode: 137 });
    });

    it("ends cleanly without throwing when the stream stops before an exit frame", async () => {
      const { sandbox } = await readySandbox("https://sbx.example", [
        ndjson([{ type: "stdout", data: btoa("partial") }]),
      ]);
      const events = [];
      for await (const ev of sandbox.processes.follow("proc_1")) events.push(ev);
      // Abort/disconnect: output seen, but no exit event and no error.
      expect(events).toEqual([{ type: "stdout", data: "partial" }]);
    });

    it("stops cleanly when the consumer breaks early", async () => {
      const { sandbox } = await readySandbox("https://sbx.example", [
        ndjson([
          { type: "stdout", data: btoa("one") },
          { type: "stdout", data: btoa("two") },
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const seen = [];
      // Breaking the loop triggers the generator's finally, which cancels the
      // underlying stream rather than leaking the follow request.
      for await (const ev of sandbox.processes.follow("proc_1")) {
        seen.push(ev);
        break;
      }
      expect(seen).toEqual([{ type: "stdout", data: "one" }]);
    });

    it("reassembles a multi-byte UTF-8 sequence split across frames", async () => {
      const { sandbox } = await readySandbox("https://sbx.example", [
        ndjson([
          { type: "stdout", data: b64([0xc3]) }, // first byte of "é"
          { type: "stdout", data: b64([0xa9]) }, // second byte of "é"
          { type: "exit", exit_code: 0 },
        ]),
      ]);
      const out = [];
      for await (const ev of sandbox.processes.follow("proc_1")) {
        if (ev.type === "stdout") out.push(ev.data);
      }
      expect(out.join("")).toBe("é");
    });
  });

  it("exposes processes on a raw SandboxConnection", async () => {
    const mock = mockFetch([json(200, { signalled_count: 0 })]);
    const neev = new Neev({ apiKey: "k", orgId: "o", projectId: "p", fetch: mock.fetch });
    const conn = neev.createSandboxConnection("https://sbx.example");
    expect(await conn.processes.killAll()).toBe(0);
  });
});
