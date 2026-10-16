import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DESCRIPTIONS,
  PARAMETERS,
  SandboxTools,
  TITLES,
  type ToolName,
} from "../src/agent-tools.js";
import {
  APIConnectionError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  DeadlineExceededError,
  InternalServerError,
  NeevError,
  NotFoundError,
  RateLimitError,
  errorFromSandboxBody,
  errorFromStatus,
} from "../src/errors.js";
import { APIError, Neev } from "../src/index.js";
import type {
  ProcessInfo,
  ProcessLogsPage,
  ProcessStatus,
  ProcessStatusOptions,
} from "../src/processes.js";
import type { Sandbox } from "../src/sandbox.js";
import { errorText, shortError } from "../src/tool-text.js";
import { json, sandboxData, snapshotData } from "./helpers.js";

type ApiErrorClass = typeof BadRequestError;

const apiError = (Cls: ApiErrorClass, message: string) => new Cls(400, { message }, undefined);

// Reads a JSON fixture shared with the Python SDK.
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const entry = (stream: "stdout" | "stderr", data: string) => ({ stream, data });

interface FakeOptions {
  execResult?: { exitCode: number; stdout: string; stderr: string };
  snapshotError?: Error;
}

// A scripted stand-in for a Sandbox handle that records every call it gets.
function fakeSandbox({
  execResult = { exitCode: 0, stdout: "ok", stderr: "" },
  snapshotError,
}: FakeOptions = {}) {
  const workspace: Record<string, Uint8Array> = {};
  const state = {
    calls: [] as unknown[][],
    fail: null as Error | null,
    page: { entries: [], cursor: 0, dropped: false, state: "running" } as ProcessLogsPage,
    processes: [] as ProcessInfo[],
    // What processes.get answers, by call: a status, an error, or a wait that ends
    // only when the caller's signal aborts.
    get: (_options: ProcessStatusOptions): Promise<ProcessStatus> =>
      Promise.resolve({ processId: "proc-1", state: "exited", exitCode: 3, startedAt: 1 }),
  };
  const sandbox = {
    async exec(command: string, options: unknown) {
      state.calls.push(["exec", command, options]);
      if (state.fail) throw state.fail;
      return execResult;
    },
    files: {
      async write(path: string, content: string) {
        if (state.fail) throw state.fail;
        workspace[path] = new TextEncoder().encode(content);
        return { bytesWritten: workspace[path].length };
      },
      async read(path: string, options?: { offset?: number; length?: number }) {
        const content = workspace[path];
        if (content === undefined) throw apiError(NotFoundError, `${path}: no such file`);
        if (!options) return content;
        state.calls.push(["files.read", path, options]);
        const start = options.offset ?? 0;
        return content.slice(start, start + (options.length ?? content.length));
      },
      // A path is a directory when some file lives under it.
      async stat(path: string) {
        state.calls.push(["files.stat", path]);
        if (state.fail) throw state.fail;
        const file = workspace[path];
        if (file) return { type: "file", size: file.length, modifiedTime: "2026-10-14T00:00:00Z" };
        if (Object.keys(workspace).some((k) => k.startsWith(`${path}/`))) {
          return { type: "directory", size: 4096, modifiedTime: "2026-10-13T00:00:00Z" };
        }
        throw errorFromSandboxBody(
          404,
          JSON.stringify({
            reason_code: "not_found",
            message: `${path}: no such file or directory`,
          }),
          undefined,
        );
      },
      async move(source: string, destination: string) {
        state.calls.push(["files.move", source, destination]);
        const content = workspace[source];
        if (content === undefined) throw apiError(NotFoundError, `${source}: no such file`);
        delete workspace[source];
        workspace[destination] = content;
        return { path: destination };
      },
      async remove(path: string, options: { recursive?: boolean }) {
        state.calls.push(["files.remove", path, options]);
        const under = Object.keys(workspace).filter((k) => k.startsWith(`${path}/`));
        if (workspace[path] === undefined && under.length === 0) {
          throw apiError(NotFoundError, `${path}: no such file or directory`);
        }
        if (under.length > 0 && !options.recursive) {
          throw apiError(BadRequestError, `${path}: directory not empty`);
        }
        for (const k of [path, ...under]) delete workspace[k];
      },
    },
    async getUrl({ port }: { port: number }) {
      state.calls.push(["getUrl", port]);
      if (state.fail) throw state.fail;
      return `https://${port}-x.sandboxes.example`;
    },
    async snapshot(options: unknown) {
      state.calls.push(["snapshot", options]);
      if (snapshotError) throw snapshotError;
      return { id: "snap-1", status: "Ready" };
    },
    async rollback(id: string) {
      state.calls.push(["rollback", id]);
      if (id !== "snap-1") throw apiError(NotFoundError, "snapshot not found");
      return sandbox;
    },
    processes: {
      async start(command: string, options: unknown) {
        state.calls.push(["processes.start", command, options]);
        if (state.fail) throw state.fail;
        return { id: "proc-1" };
      },
      async logs(processId: string, options: unknown) {
        state.calls.push(["processes.logs", processId, options]);
        if (processId !== "proc-1") throw apiError(NotFoundError, "process not found");
        return state.page;
      },
      async get(processId: string, options: ProcessStatusOptions = {}) {
        state.calls.push(["processes.get", processId, options.wait ?? false]);
        return state.get(options);
      },
      async kill(processId: string) {
        state.calls.push(["processes.kill", processId]);
        if (processId !== "proc-1") throw apiError(NotFoundError, "process not found");
        return true;
      },
      async list() {
        state.calls.push(["processes.list"]);
        if (state.fail) throw state.fail;
        return state.processes;
      },
    },
  };
  return { state, workspace, sandbox: sandbox as unknown as Sandbox };
}

// A blocking get that never sees the process exit: it rejects like the SDK's
// transport does once the caller's signal aborts.
function waitUntilAborted(options: ProcessStatusOptions): Promise<ProcessStatus> {
  return new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () =>
      reject(new APIConnectionError("Request aborted by caller")),
    );
  });
}

describe("agent-tools", () => {
  describe("DESCRIPTIONS", () => {
    it("covers every tool", () => {
      expect(Object.keys(DESCRIPTIONS).sort()).toEqual([
        "checkpoint",
        "delete_path",
        "expose_port",
        "list_processes",
        "move_path",
        "read_file",
        "read_process_output",
        "rollback",
        "run_command",
        "start_process",
        "stat_path",
        "stop_process",
        "write_file",
      ]);
    });

    it("matches the shared fixture byte for byte", () => {
      expect(JSON.stringify(DESCRIPTIONS)).toBe(JSON.stringify(fixture("agent_tool_descriptions")));
    });

    it("cannot be changed at runtime", () => {
      expect(Object.isFrozen(DESCRIPTIONS)).toBe(true);
    });
  });

  describe("TITLES", () => {
    it("covers the same tools as DESCRIPTIONS, in order", () => {
      expect(Object.keys(TITLES)).toEqual(Object.keys(DESCRIPTIONS));
    });

    it("matches the shared fixture byte for byte", () => {
      expect(JSON.stringify(TITLES)).toBe(JSON.stringify(fixture("agent_tool_titles")));
    });

    it("cannot be changed at runtime", () => {
      expect(Object.isFrozen(TITLES)).toBe(true);
      expect(() => {
        (TITLES as Record<string, string>).run_command = "x";
      }).toThrow(TypeError);
    });
  });

  describe("names", () => {
    const safe = [
      "run_command",
      "write_file",
      "read_file",
      "stat_path",
      "move_path",
      "delete_path",
    ];
    const processes = ["start_process", "read_process_output", "stop_process", "list_processes"];

    it("defaults to the safe tools", () => {
      expect(new SandboxTools(fakeSandbox().sandbox).names()).toEqual(safe);
    });

    it("includes opt-in tools only when enabled", () => {
      const tools = new SandboxTools(fakeSandbox().sandbox, {
        allowPreview: true,
        allowRollback: true,
        allowProcesses: true,
      });
      expect(tools.names()).toEqual([
        "run_command",
        "write_file",
        "read_file",
        "stat_path",
        "move_path",
        "delete_path",
        "expose_port",
        "checkpoint",
        "rollback",
        "start_process",
        "read_process_output",
        "stop_process",
        "list_processes",
      ]);
    });

    it.each([
      [{ allowPreview: true }, [...safe, "expose_port"]],
      [{ allowRollback: true }, [...safe, "checkpoint", "rollback"]],
      [{ allowProcesses: true }, [...safe, ...processes]],
    ])("adds only the tools %j enables", (options, want) => {
      expect(new SandboxTools(fakeSandbox().sandbox, options).names()).toEqual(want);
    });
  });

  describe("runCommand", () => {
    it("uses a login shell and the default timeout", async () => {
      const { state, sandbox } = fakeSandbox();
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({
        exit_code: 0,
        stdout: "ok",
        stderr: "",
      });
      expect(state.calls).toEqual([
        ["exec", "sh", { args: ["-lc", "ls"], cwd: undefined, timeoutMs: 60_000 }],
      ]);
    });

    it.each([
      [5, 5_000],
      [0, 1_000],
      [-3, 1_000],
      [9_999, 600_000],
      [Number.NaN, 60_000],
      [Number.POSITIVE_INFINITY, 60_000],
      ["300", 300_000],
      [" 2.5 ", 2_500],
      [2.01, 2_010],
      ["abc", 60_000],
      ["0x10", 60_000],
      ["Infinity", 60_000],
      ["", 60_000],
      [true, 60_000],
    ])("clamps timeout_s %s to %s ms", async (given, ms) => {
      const { state, sandbox } = fakeSandbox();
      await new SandboxTools(sandbox).runCommand({ command: "ls", timeout_s: given as number });
      expect(state.calls[0]?.[2]).toMatchObject({ timeoutMs: ms });
    });

    it("treats null optionals as defaults", async () => {
      const { state, sandbox } = fakeSandbox();
      await new SandboxTools(sandbox).runCommand({ command: "ls", cwd: null, timeout_s: null });
      expect(state.calls[0]?.[2]).toEqual({
        args: ["-lc", "ls"],
        cwd: undefined,
        timeoutMs: 60_000,
      });
    });

    it("returns a non-zero exit as data", async () => {
      const { sandbox } = fakeSandbox({
        execResult: { exitCode: 2, stdout: "", stderr: "no such file" },
      });
      expect(await new SandboxTools(sandbox).runCommand({ command: "cat nope" })).toEqual({
        exit_code: 2,
        stdout: "",
        stderr: "no such file",
      });
    });

    it("leaves output at the cap alone", async () => {
      const { sandbox } = fakeSandbox({
        execResult: { exitCode: 0, stdout: "x".repeat(10_000), stderr: "hello" },
      });
      expect(await new SandboxTools(sandbox).runCommand({ command: "yes" })).toEqual({
        exit_code: 0,
        stdout: "x".repeat(10_000),
        stderr: "hello",
      });
    });

    it("keeps the head and tail of long output and counts dropped bytes", async () => {
      const stdout = "h".repeat(4_000) + "m".repeat(5_000) + "t".repeat(6_000);
      const { sandbox } = fakeSandbox({
        execResult: { exitCode: 0, stdout, stderr: "e".repeat(20_000) },
      });
      const r = await new SandboxTools(sandbox).runCommand({ command: "yes" });
      expect(r).toMatchObject({
        stdout: `${"h".repeat(4_000)}\n…[5000 bytes truncated]…\n${"t".repeat(6_000)}`,
      });
      expect((r as { stderr: string }).stderr).toContain("…[10000 bytes truncated]…");
    });

    it("replaces a character split by the cut", async () => {
      const { sandbox } = fakeSandbox({
        execResult: { exitCode: 0, stdout: `a${"é".repeat(6_000)}`, stderr: "" },
      });
      const r = await new SandboxTools(sandbox).runCommand({ command: "yes" });
      expect((r as { stdout: string }).stdout).toContain("�");
    });

    it("explains a 524 from the network edge", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new InternalServerError(524, { message: "<!DOCTYPE html>" }, undefined);
      expect(await new SandboxTools(sandbox).runCommand({ command: "sleep 150" })).toEqual({
        error:
          "the command printed nothing for about 2 minutes and the connection was cut; it may still be running. Use start_process for long or quiet commands",
      });
    });

    it("throws other server errors and a 524 outside run_command", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new InternalServerError(500, { message: "boom" }, undefined);
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      await expect(tools.runCommand({ command: "ls" })).rejects.toBeInstanceOf(InternalServerError);
      state.fail = new InternalServerError(524, { message: "<!DOCTYPE html>" }, undefined);
      await expect(tools.startProcess({ command: "ls" })).rejects.toBeInstanceOf(
        InternalServerError,
      );
    });

    it("says the command did not finish on a deadline", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new DeadlineExceededError(504, undefined, undefined);
      const tools = new SandboxTools(sandbox);
      expect(await tools.runCommand({ command: "sleep 5", timeout_s: 1 })).toEqual({
        error: "command did not finish within 1 s",
      });
      expect(await tools.runCommand({ command: "sleep 5", timeout_s: 9_999 })).toEqual({
        error: "command did not finish within 600 s",
      });
    });
  });

  describe("errors", () => {
    it.each([BadRequestError, NotFoundError])("turns %o into a result", async (Cls) => {
      const { state, sandbox } = fakeSandbox();
      state.fail = apiError(Cls, "path is outside the workspace");
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({
        error: "HTTP 400: path is outside the workspace",
      });
    });

    it("builds the text from the error's fields, without the request id", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new BadRequestError(
        400,
        { code: "invalid_argument", message: 'path "/etc/passwd" escapes workspace root' },
        "req-1",
      );
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({
        error: 'HTTP 400 invalid_argument: path "/etc/passwd" escapes workspace root',
      });
    });

    it("makes other deadlines a short timeout error", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new DeadlineExceededError(504, undefined, undefined);
      expect(await new SandboxTools(sandbox).writeFile({ path: "a.txt", content: "x" })).toEqual({
        error: "timed out",
      });
    });

    it("keeps a capped first line of a long multi-line error", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new NeevError(`${"x".repeat(2_000)}\n<html>\n${"y".repeat(5_000)}`);
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({
        error: `${"x".repeat(500)}…`,
      });
    });

    it("throws auth errors", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = apiError(AuthenticationError, "bad key");
      await expect(new SandboxTools(sandbox).runCommand({ command: "ls" })).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    });

    it("throws connection errors", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new APIConnectionError("connection reset");
      await expect(
        new SandboxTools(sandbox).writeFile({ path: "a.txt", content: "x" }),
      ).rejects.toBeInstanceOf(APIConnectionError);
    });
  });

  describe("files", () => {
    it("round-trips a write and a read", async () => {
      const tools = new SandboxTools(fakeSandbox().sandbox);
      expect(await tools.writeFile({ path: "a.txt", content: "héllo" })).toEqual({
        bytes_written: 6,
      });
      expect(await tools.readFile({ path: "a.txt" })).toEqual({ content: "héllo" });
    });

    it("makes a missing file an error result", async () => {
      const r = await new SandboxTools(fakeSandbox().sandbox).readFile({ path: "nope.txt" });
      expect((r as { error: string }).error).toContain("nope.txt: no such file");
    });
  });

  describe("opt-in tools", () => {
    it("refuse when not enabled", async () => {
      const { state, sandbox } = fakeSandbox();
      const tools = new SandboxTools(sandbox);
      expect(await tools.exposePort({ port: 3000 })).toEqual({
        error: "expose_port is not enabled for this agent",
      });
      expect(await tools.checkpoint()).toEqual({
        error: "checkpoint is not enabled for this agent",
      });
      expect(await tools.rollback({ checkpoint_id: "snap-1" })).toEqual({
        error: "rollback is not enabled for this agent",
      });
      expect(await tools.startProcess({ command: "sleep 1" })).toEqual({
        error: "start_process is not enabled for this agent",
      });
      expect(await tools.readProcessOutput({ process_id: "proc-1" })).toEqual({
        error: "read_process_output is not enabled for this agent",
      });
      expect(await tools.stopProcess({ process_id: "proc-1" })).toEqual({
        error: "stop_process is not enabled for this agent",
      });
      expect(await tools.listProcesses()).toEqual({
        error: "list_processes is not enabled for this agent",
      });
      expect(state.calls).toEqual([]);
    });
  });

  describe("exposePort", () => {
    it("returns the preview URL", async () => {
      const tools = new SandboxTools(fakeSandbox().sandbox, { allowPreview: true });
      expect(await tools.exposePort({ port: 3000 })).toEqual({
        preview_url: "https://3000-x.sandboxes.example",
      });
    });

    it("makes a URL that never becomes routable an error result", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new NeevError(
        "Preview URL https://3000-x.sandboxes.example was not routable within 30000ms.",
      );
      const tools = new SandboxTools(sandbox, { allowPreview: true });
      expect(await tools.exposePort({ port: 3000 })).toEqual({
        error: "Preview URL https://3000-x.sandboxes.example was not routable within 30000ms.",
      });
    });
  });

  describe("checkpoint and rollback", () => {
    it("waits for Ready and passes the label", async () => {
      const { state, sandbox } = fakeSandbox();
      const tools = new SandboxTools(sandbox, { allowRollback: true });
      expect(await tools.checkpoint({ label: "pre" })).toEqual({ checkpoint_id: "snap-1" });
      expect(await tools.checkpoint()).toEqual({ checkpoint_id: "snap-1" });
      expect(state.calls).toEqual([
        ["snapshot", { name: "pre", waitUntilReady: true, timeoutMs: 300_000 }],
        ["snapshot", { waitUntilReady: true, timeoutMs: 300_000 }],
      ]);
    });

    it("makes rollback to an unknown checkpoint an error result", async () => {
      const tools = new SandboxTools(fakeSandbox().sandbox, { allowRollback: true });
      expect(await tools.rollback({ checkpoint_id: "snap-1" })).toEqual({ ok: true });
      const r = await tools.rollback({ checkpoint_id: "snap-9" });
      expect((r as { error: string }).error).toContain("snapshot not found");
    });
  });

  describe("startProcess", () => {
    it("runs a login shell in cwd", async () => {
      const { state, sandbox } = fakeSandbox();
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      expect(await tools.startProcess({ command: "npm run dev", cwd: "app" })).toEqual({
        process_id: "proc-1",
      });
      await tools.startProcess({ command: "ls", cwd: null });
      expect(state.calls).toEqual([
        ["processes.start", "sh", { args: ["-lc", "npm run dev"], cwd: "app" }],
        ["processes.start", "sh", { args: ["-lc", "ls"], cwd: undefined }],
      ]);
    });

    it.each(["too many concurrent processes", "too many in-flight requests"])(
      "makes resource_exhausted (%s) an error result",
      async (message) => {
        const { state, sandbox } = fakeSandbox();
        state.fail = new RateLimitError(429, { code: "resource_exhausted", message }, undefined);
        const tools = new SandboxTools(sandbox, { allowProcesses: true });
        expect(await tools.startProcess({ command: "sleep 1" })).toEqual({
          error: `HTTP 429 resource_exhausted: ${message}`,
        });
      },
    );

    it("throws other rate limits", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new RateLimitError(429, { message: "slow down" }, undefined);
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      await expect(tools.startProcess({ command: "sleep 1" })).rejects.toBeInstanceOf(
        RateLimitError,
      );
    });
  });

  describe("readProcessOutput", () => {
    it("splits streams and passes the cursor", async () => {
      const { state, sandbox } = fakeSandbox();
      state.page = {
        entries: [
          entry("stdout", "line 1\n"),
          entry("stderr", "warn\n"),
          entry("stdout", "line 2\n"),
        ],
        cursor: 42,
        dropped: false,
        state: "running",
      };
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      expect(await tools.readProcessOutput({ process_id: "proc-1", cursor: 7 })).toEqual({
        stdout: "line 1\nline 2\n",
        stderr: "warn\n",
        cursor: 42,
        state: "running",
        dropped: false,
      });
      expect(state.calls).toEqual([["processes.logs", "proc-1", { cursor: 7 }]]);
    });

    it("adds the exit code once exited", async () => {
      const { state, sandbox } = fakeSandbox();
      state.page = {
        entries: [entry("stderr", "bye\n")],
        cursor: 9,
        dropped: true,
        state: "exited",
      };
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      expect(await tools.readProcessOutput({ process_id: "proc-1", cursor: null })).toEqual({
        stdout: "",
        stderr: "bye\n",
        cursor: 9,
        state: "exited",
        dropped: true,
        exit_code: 3,
      });
      expect(state.calls).toEqual([
        ["processes.logs", "proc-1", { cursor: undefined }],
        ["processes.get", "proc-1", false],
      ]);
    });

    it("keeps the page without exit_code when the status is gone", async () => {
      const { state, sandbox } = fakeSandbox();
      state.page = {
        entries: [entry("stdout", "done\n")],
        cursor: 5,
        dropped: false,
        state: "exited",
      };
      state.get = () => Promise.reject(apiError(NotFoundError, "process not found"));
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      expect(await tools.readProcessOutput({ process_id: "proc-1" })).toEqual({
        stdout: "done\n",
        stderr: "",
        cursor: 5,
        state: "exited",
        dropped: false,
      });
    });

    it("throws a status read that fails for another reason", async () => {
      const { state, sandbox } = fakeSandbox();
      state.page = { entries: [], cursor: 0, dropped: false, state: "exited" };
      state.get = () => Promise.reject(new APIConnectionError("connection reset"));
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      await expect(tools.readProcessOutput({ process_id: "proc-1" })).rejects.toBeInstanceOf(
        APIConnectionError,
      );
    });

    it("truncates each stream", async () => {
      const { state, sandbox } = fakeSandbox();
      state.page = {
        entries: [entry("stdout", "o".repeat(20_000)), entry("stderr", "e".repeat(20_000))],
        cursor: 40_000,
        dropped: false,
        state: "running",
      };
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      const r = (await tools.readProcessOutput({ process_id: "proc-1" })) as {
        stdout: string;
        stderr: string;
      };
      expect(r.stdout).toContain("…[10000 bytes truncated]…");
      expect(r.stderr).toContain("…[10000 bytes truncated]…");
    });

    it("waits for a running process that exits within wait_s", async () => {
      const { state, sandbox } = fakeSandbox();
      state.page = {
        entries: [entry("stdout", "built\n")],
        cursor: 6,
        dropped: false,
        state: "exited",
      };
      let signal: AbortSignal | undefined;
      state.get = (options) => {
        signal = options.signal;
        return Promise.resolve({ processId: "proc-1", state: "exited", exitCode: 0, startedAt: 1 });
      };
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      expect(await tools.readProcessOutput({ process_id: "proc-1", wait_s: 30 })).toEqual({
        stdout: "built\n",
        stderr: "",
        cursor: 6,
        state: "exited",
        dropped: false,
        exit_code: 0,
      });
      // The wait's status supplies the exit code, so there is no second get.
      expect(state.calls).toEqual([
        ["processes.get", "proc-1", true],
        ["processes.logs", "proc-1", { cursor: undefined }],
      ]);
      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it("reads a still-running process once wait_s runs out", async () => {
      const { state, sandbox } = fakeSandbox();
      state.page = {
        entries: [entry("stdout", "50%\n")],
        cursor: 4,
        dropped: false,
        state: "running",
      };
      state.get = waitUntilAborted;
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      const started = Date.now();
      expect(await tools.readProcessOutput({ process_id: "proc-1", wait_s: 0.05 })).toEqual({
        stdout: "50%\n",
        stderr: "",
        cursor: 4,
        state: "running",
        dropped: false,
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(40);
      expect(state.calls).toEqual([
        ["processes.get", "proc-1", true],
        ["processes.logs", "proc-1", { cursor: undefined }],
      ]);
    });

    it("throws a wait that fails for another reason", async () => {
      const { state, sandbox } = fakeSandbox();
      state.get = () => Promise.reject(new APIConnectionError("connection reset"));
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      await expect(
        tools.readProcessOutput({ process_id: "proc-1", wait_s: 5 }),
      ).rejects.toBeInstanceOf(APIConnectionError);
    });

    it("gets the exit code after a wait the server ended while running", async () => {
      const { state, sandbox } = fakeSandbox();
      state.page = { entries: [], cursor: 0, dropped: false, state: "exited" };
      const statuses: ProcessStatus[] = [
        { processId: "proc-1", state: "running", exitCode: null, startedAt: 1 },
        { processId: "proc-1", state: "exited", exitCode: 7, startedAt: 1 },
      ];
      state.get = () => Promise.resolve(statuses.shift() as ProcessStatus);
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      expect(await tools.readProcessOutput({ process_id: "proc-1", wait_s: 1 })).toMatchObject({
        exit_code: 7,
      });
    });

    it.each([-5, 0, null, Number.NaN])("does not wait for wait_s %s", async (given) => {
      const { state, sandbox } = fakeSandbox();
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      await tools.readProcessOutput({ process_id: "proc-1", wait_s: given });
      expect(state.calls).toEqual([["processes.logs", "proc-1", { cursor: undefined }]]);
    });

    it("caps wait_s at 60 s", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const { sandbox } = fakeSandbox();
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      await tools.readProcessOutput({ process_id: "proc-1", wait_s: 9_999 });
      expect(timeout).toHaveBeenCalledWith(60_000);
      timeout.mockRestore();
    });

    it("makes unknown process ids error results", async () => {
      const tools = new SandboxTools(fakeSandbox().sandbox, { allowProcesses: true });
      const read = await tools.readProcessOutput({ process_id: "proc-9" });
      expect((read as { error: string }).error).toContain("process not found");
      const stop = await tools.stopProcess({ process_id: "proc-9" });
      expect((stop as { error: string }).error).toContain("process not found");
    });
  });

  describe("stopProcess", () => {
    it("reports whether it was signalled", async () => {
      const { state, sandbox } = fakeSandbox();
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      expect(await tools.stopProcess({ process_id: "proc-1" })).toEqual({ ok: true });
      expect(state.calls).toEqual([["processes.kill", "proc-1"]]);
    });
  });

  describe("PARAMETERS", () => {
    it("matches the shared fixture byte for byte", () => {
      expect(JSON.stringify(PARAMETERS)).toBe(JSON.stringify(fixture("agent_tool_parameters")));
    });

    it("covers the same tools as DESCRIPTIONS", () => {
      expect(Object.keys(PARAMETERS)).toEqual(Object.keys(DESCRIPTIONS));
    });

    it("shares no nested object between tools", () => {
      const seen = new Set<object>();
      let count = 0;
      const walk = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        count++;
        seen.add(value);
        for (const inner of Object.values(value)) walk(inner);
      };
      walk(PARAMETERS);
      expect(seen.size).toBe(count);
    });

    it("cannot be changed at runtime, however deep", () => {
      expect(Object.isFrozen(PARAMETERS)).toBe(true);
      expect(Object.isFrozen(PARAMETERS.run_command)).toBe(true);
      expect(Object.isFrozen(PARAMETERS.run_command.properties)).toBe(true);
      const props = PARAMETERS.read_process_output.properties as Record<string, object>;
      expect(Object.isFrozen(props.wait_s)).toBe(true);
      expect(Object.isFrozen(PARAMETERS.write_file.required)).toBe(true);
      expect(() => {
        (DESCRIPTIONS as Record<string, string>).run_command = "x";
      }).toThrow(TypeError);
    });
  });

  describe("call", () => {
    const all = { allowPreview: true, allowRollback: true, allowProcesses: true };
    const valid: Record<ToolName, Record<string, unknown>> = {
      run_command: { command: "ls" },
      write_file: { path: "a.txt", content: "x" },
      read_file: { path: "a.txt" },
      expose_port: { port: 3000 },
      checkpoint: {},
      rollback: { checkpoint_id: "snap-1" },
      start_process: { command: "sleep 1" },
      read_process_output: { process_id: "proc-1" },
      stop_process: { process_id: "proc-1" },
      stat_path: { path: "a.txt" },
      move_path: { source: "a.txt", destination: "b.txt" },
      delete_path: { path: "b.txt" },
      list_processes: {},
    };

    it("runs every enabled tool by its contract name", async () => {
      const tools = new SandboxTools(fakeSandbox().sandbox, all);
      for (const name of tools.names()) {
        const result = await tools.call(name, valid[name]);
        expect(result, name).not.toHaveProperty("error");
      }
    });

    it("answers an unknown tool with an error result", async () => {
      expect(await new SandboxTools(fakeSandbox().sandbox).call("rm_rf", {})).toEqual({
        error: "unknown tool: rm_rf",
      });
    });

    it("refuses a disabled tool", async () => {
      const { state, sandbox } = fakeSandbox();
      expect(await new SandboxTools(sandbox).call("expose_port", { port: 3000 })).toEqual({
        error: "expose_port is not enabled for this agent",
      });
      expect(state.calls).toEqual([]);
    });

    it("refuses a missing command instead of running an empty one", async () => {
      const { state, sandbox } = fakeSandbox();
      const tools = new SandboxTools(sandbox, all);
      expect(await tools.call("run_command", {})).toEqual({
        error: 'invalid arguments for run_command: missing a required argument: "command"',
      });
      expect(await tools.call("start_process", { command: null })).toEqual({
        error: "invalid arguments for start_process: command must be string",
      });
      expect(state.calls).toEqual([]);
    });

    it.each([
      ["write_file", { path: 1, content: "x" }, "path must be string"],
      ["write_file", { path: "a.txt" }, 'missing a required argument: "content"'],
      ["read_file", "a.txt", "expected an object"],
      ["read_file", ["a.txt"], "expected an object"],
      ["run_command", { command: "ls", cwd: 3 }, "cwd must be string"],
      ["expose_port", {}, 'missing a required argument: "port"'],
      ["expose_port", { port: "http" }, "port must be integer"],
      ["expose_port", { port: 80.5 }, "port must be integer"],
      ["checkpoint", { label: 7 }, "label must be string"],
      ["rollback", {}, 'missing a required argument: "checkpoint_id"'],
      ["read_process_output", { process_id: 1 }, "process_id must be string"],
      [
        "run_command",
        { command: "ls", timeout: 5 },
        'got an unexpected keyword argument "timeout"',
      ],
      ["write_file", { path: "a.txt", content: 123 }, "content must be string"],
      ["write_file", { path: "a.txt", content: null }, "content must be string"],
      ["run_command", { command: ["ls"] }, "command must be string"],
      ["start_process", { command: "ls", cwd: {} }, "cwd must be string"],
      ["expose_port", { port: Number.POSITIVE_INFINITY }, "port must be integer"],
      ["expose_port", { port: "1e400" }, "port must be integer"],
      ["stop_process", undefined, 'missing a required argument: "process_id"'],
      ["stat_path", {}, 'missing a required argument: "path"'],
      ["move_path", { source: "a.txt" }, 'missing a required argument: "destination"'],
      ["move_path", { source: "a.txt", destination: 2 }, "destination must be string"],
      ["delete_path", { path: "d", recursive: "true" }, "recursive must be boolean"],
      ["delete_path", { path: "d", recursive: 1 }, "recursive must be boolean"],
      ["delete_path", { path: "d", recursive: [] }, "recursive must be boolean"],
      ["list_processes", { all: true }, 'got an unexpected keyword argument "all"'],
      ["read_file", { path: "a.txt", offset: 1.5 }, "offset must be integer"],
      ["read_file", { path: "a.txt", length: "ten" }, "length must be integer"],
      ["read_file", { path: "a.txt", offset: true }, "offset must be integer"],
    ])("rejects %s with %j", async (name, args, reason) => {
      const { state, sandbox } = fakeSandbox();
      expect(await new SandboxTools(sandbox, all).call(name, args)).toEqual({
        error: `invalid arguments for ${name}: ${reason}`,
      });
      expect(state.calls).toEqual([]);
    });

    it.each(["1e400", 10n, {}, [], Number.NEGATIVE_INFINITY])(
      "falls back to defaults for numeric input %s on direct calls",
      async (value) => {
        const { state, sandbox } = fakeSandbox();
        const tools = new SandboxTools(sandbox, all);
        await tools.runCommand({ command: "ls", timeout_s: value as number });
        await tools.readProcessOutput({
          process_id: "proc-1",
          cursor: value as number,
          wait_s: value as number,
        });

        expect(state.calls).toEqual([
          ["exec", "sh", { args: ["-lc", "ls"], cwd: undefined, timeoutMs: 60_000 }],
          ["processes.logs", "proc-1", { cursor: undefined }],
        ]);
      },
    );

    it.each([
      ["run_command", { command: "ls", timeout_s: "abc" }, "timeout_s must be number"],
      ["run_command", { command: "ls", timeout_s: true }, "timeout_s must be number"],
      ["run_command", { command: "ls", timeout_s: "1e400" }, "timeout_s must be number"],
      ["read_process_output", { process_id: "proc-1", cursor: 2.5 }, "cursor must be integer"],
      ["read_process_output", { process_id: "proc-1", wait_s: {} }, "wait_s must be number"],
    ])("checks numbers strictly in call(): %s %j", async (name, args, reason) => {
      const { state, sandbox } = fakeSandbox();
      expect(await new SandboxTools(sandbox, all).call(name, args)).toEqual({
        error: `invalid arguments for ${name}: ${reason}`,
      });
      expect(state.calls).toEqual([]);
    });

    it("lets call() pass null for an optional argument", async () => {
      const { state, sandbox } = fakeSandbox();
      await new SandboxTools(sandbox, all).call("read_process_output", {
        process_id: "proc-1",
        cursor: null,
        wait_s: null,
      });
      expect(state.calls).toEqual([["processes.logs", "proc-1", { cursor: undefined }]]);
    });

    it("checks arguments on direct method calls too", async () => {
      const { state, sandbox } = fakeSandbox();
      const tools = new SandboxTools(sandbox);
      expect(await tools.runCommand("ls" as never)).toEqual({
        error: "invalid arguments for run_command: expected an object",
      });
      expect(await tools.writeFile({ path: 1 } as never)).toEqual({
        error: 'invalid arguments for write_file: missing a required argument: "content"',
      });
      expect(state.calls).toEqual([]);
    });

    it("rejects a BigInt port", async () => {
      expect(
        await new SandboxTools(fakeSandbox().sandbox, all).call("expose_port", { port: 10n }),
      ).toEqual({
        error: "invalid arguments for expose_port: port must be integer",
      });
    });

    it("takes a numeric string port", async () => {
      const { state, sandbox } = fakeSandbox();
      await new SandboxTools(sandbox, all).call("expose_port", { port: "3000" });
      expect(state.calls).toEqual([["getUrl", 3000]]);
    });

    it("takes a numeric string cursor", async () => {
      const { state, sandbox } = fakeSandbox();
      await new SandboxTools(sandbox, all).call("read_process_output", {
        process_id: "proc-1",
        cursor: "7",
      });
      expect(state.calls).toEqual([["processes.logs", "proc-1", { cursor: 7 }]]);
    });

    it("works on methods taken off the instance", async () => {
      const { state, sandbox } = fakeSandbox();
      const { runCommand, call, names } = new SandboxTools(sandbox);
      expect(names()).toHaveLength(6);
      expect(await runCommand({ command: "ls" })).toMatchObject({ exit_code: 0 });
      expect(await call("run_command", { command: "pwd" })).toMatchObject({ exit_code: 0 });
      expect(state.calls).toHaveLength(2);
    });
  });

  describe("readFile paging", () => {
    // "aé€😀" is 1 + 2 + 3 + 4 bytes: characters start at bytes 0, 1, 3 and 6.
    const text = "aé€😀";

    it.each([
      ["a whole small file", { offset: 0 }, { content: text, next_offset: 10, eof: true }],
      ["the first page", { offset: 0, length: 3 }, { content: "aé", next_offset: 3, eof: false }],
      ["a page ending mid-character", { length: 5 }, { content: "aé", next_offset: 3, eof: false }],
      [
        "a page starting mid-character",
        { offset: 2, length: 4 },
        { content: "€", next_offset: 6, eof: false },
      ],
      ["the last page", { offset: 6, length: 4 }, { content: "😀", next_offset: 10, eof: true }],
      ["a page past the end", { offset: 50 }, { content: "", next_offset: 50, eof: true }],
      ["a page right at the end", { offset: 10 }, { content: "", next_offset: 10, eof: true }],
      [
        "a null offset with a length",
        { offset: null, length: 1 },
        { content: "a", next_offset: 1, eof: false },
      ],
      [
        "a page of continuation bytes only",
        { offset: 7, length: 2 },
        { content: "", next_offset: 10, eof: true },
      ],
    ])("reads %s", async (_name, range, want) => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["t.txt"] = new TextEncoder().encode(text);
      expect(await new SandboxTools(sandbox).readFile({ path: "t.txt", ...range })).toEqual(want);
    });

    it("reads a large file in full by following next_offset", async () => {
      const { workspace, sandbox } = fakeSandbox();
      const big = "é😀x".repeat(5_000);
      workspace["big.txt"] = new TextEncoder().encode(big);
      const tools = new SandboxTools(sandbox);
      let out = "";
      let offset = 0;
      for (let turn = 0; turn < 20; turn++) {
        const page = (await tools.readFile({ path: "big.txt", offset })) as {
          content: string;
          next_offset: number;
          eof: boolean;
        };
        out += page.content;
        offset = page.next_offset;
        if (page.eof) break;
      }
      expect(out).toBe(big);
    });

    it.each([
      [undefined, 10_007],
      [0, 8],
      [-4, 8],
      [50_000, 10_007],
      ["20", 27],
    ])("clamps length %s and asks for 7 bytes more", async (length, asked) => {
      const { state, workspace, sandbox } = fakeSandbox();
      workspace["t.txt"] = new TextEncoder().encode(text);
      await new SandboxTools(sandbox).readFile({ path: "t.txt", offset: 0, length });
      expect(state.calls).toEqual([["files.read", "t.txt", { offset: 0, length: asked }]]);
    });

    it("clamps a negative offset on direct calls to 0", async () => {
      const { state, workspace, sandbox } = fakeSandbox();
      workspace["t.txt"] = new TextEncoder().encode(text);
      expect(await new SandboxTools(sandbox).readFile({ path: "t.txt", offset: -3 })).toEqual({
        content: text,
        next_offset: 10,
        eof: true,
      });
      expect(state.calls).toEqual([["files.read", "t.txt", { offset: 0, length: 10_007 }]]);
    });

    it("keeps the unpaged read when offset and length are null", async () => {
      const { state, workspace, sandbox } = fakeSandbox();
      workspace["big.txt"] = new TextEncoder().encode("x".repeat(20_000));
      const r = (await new SandboxTools(sandbox).readFile({
        path: "big.txt",
        offset: null,
        length: null,
      })) as { content: string };
      expect(Object.keys(r)).toEqual(["content"]);
      expect(r.content).toContain("…[10000 bytes truncated]…");
      expect(state.calls).toEqual([]);
    });

    it("makes a page that is not UTF-8 an error result", async () => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["blob.bin"] = new Uint8Array([0x61, 0xff, 0xfe, 0x62]);
      expect(await new SandboxTools(sandbox).readFile({ path: "blob.bin", offset: 0 })).toEqual({
        error: "not UTF-8 text",
      });
    });

    it("widens a window too short for one character to the whole character", async () => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["t.txt"] = new TextEncoder().encode(text);
      expect(
        await new SandboxTools(sandbox).readFile({ path: "t.txt", offset: 6, length: 2 }),
      ).toEqual({ content: "😀", next_offset: 10, eof: true });
    });

    it.each([
      ["€uro", 1],
      ["€uro", 2],
      ["€uro", 3],
      ["😀a", 1],
      ["😀a", 2],
      ["😀a", 3],
    ])("never stalls reading %s with length %s", async (file, length) => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["t.txt"] = new TextEncoder().encode(file);
      const tools = new SandboxTools(sandbox);
      let out = "";
      let offset = 0;
      for (let turn = 0; turn < 10; turn++) {
        const page = (await tools.readFile({ path: "t.txt", offset, length })) as {
          content: string;
          next_offset: number;
          eof: boolean;
        };
        out += page.content;
        if (page.eof) break;
        expect(page.next_offset).toBeGreaterThan(offset);
        offset = page.next_offset;
      }
      expect(out).toBe(file);
    });

    it.each([
      ["a page starting 1 byte into a character", 1, { content: "a", next_offset: 5, eof: true }],
      ["a page starting 3 bytes into a character", 3, { content: "a", next_offset: 5, eof: true }],
    ])("skips the rest of a character for %s", async (_name, offset, want) => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["t.txt"] = new TextEncoder().encode("😀a");
      expect(
        await new SandboxTools(sandbox).readFile({ path: "t.txt", offset, length: 1 }),
      ).toEqual(want);
    });

    it.each([
      ["4 continuation bytes in a row", [0x80, 0x80, 0x80, 0x80, 0x61], 0, 10],
      ["an 0xF8 lead byte", [0x61, 0xf8, 0x62, 0x63], 0, 2],
      ["an 0xF8 lead byte alone", [0xf8, 0x62], 0, 1],
      ["a stray continuation byte mid-page", [0x61, 0x80, 0x62], 0, 10],
    ])("makes %s not UTF-8 text", async (_name, bytes, offset, length) => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["b.bin"] = new Uint8Array(bytes);
      expect(await new SandboxTools(sandbox).readFile({ path: "b.bin", offset, length })).toEqual({
        error: "not UTF-8 text",
      });
    });

    it("makes a character cut by the real end of file an error result", async () => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["cut.txt"] = new Uint8Array([0x61, 0xe2, 0x82]);
      expect(await new SandboxTools(sandbox).readFile({ path: "cut.txt", offset: 0 })).toEqual({
        error: "not UTF-8 text",
      });
    });

    it("makes a missing file an error result", async () => {
      const r = await new SandboxTools(fakeSandbox().sandbox).readFile({
        path: "nope.txt",
        offset: 0,
      });
      expect((r as { error: string }).error).toContain("nope.txt: no such file");
    });

    it("pages through call() too", async () => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["t.txt"] = new TextEncoder().encode(text);
      expect(
        await new SandboxTools(sandbox).call("read_file", { path: "t.txt", offset: 1, length: 2 }),
      ).toEqual({ content: "é", next_offset: 3, eof: false });
    });
  });

  describe("statPath", () => {
    it("reports a file, a directory and a missing path", async () => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["src/a.txt"] = new TextEncoder().encode("héllo");
      const tools = new SandboxTools(sandbox);
      expect(await tools.statPath({ path: "src/a.txt" })).toEqual({
        exists: true,
        type: "file",
        size: 6,
        modified_time: "2026-10-14T00:00:00Z",
      });
      expect(await tools.statPath({ path: "src" })).toEqual({
        exists: true,
        type: "directory",
        size: 4096,
        modified_time: "2026-10-13T00:00:00Z",
      });
      expect(await tools.statPath({ path: "nope" })).toEqual({ exists: false });
    });

    it.each([
      [{ reason_code: "not_found", message: "gone" }, { exists: false }],
      [
        { code: "not_found", message: "sandbox not found" },
        { error: "HTTP 404 not_found: sandbox not found" },
      ],
      [{ message: "no route" }, { error: "HTTP 404: no route" }],
    ])("reads a 404 with body %j as %j", async (body, want) => {
      const { state, sandbox } = fakeSandbox();
      state.fail = errorFromSandboxBody(404, JSON.stringify(body), undefined);
      expect(await new SandboxTools(sandbox).statPath({ path: "a" })).toEqual(want);
    });

    it("makes a bad path an error result", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = apiError(BadRequestError, "path escapes workspace root");
      expect(await new SandboxTools(sandbox).statPath({ path: "../etc" })).toEqual({
        error: "HTTP 400: path escapes workspace root",
      });
    });

    it("throws auth errors", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new AuthenticationError(401, { message: "bad key" }, undefined);
      await expect(new SandboxTools(sandbox).statPath({ path: "a" })).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    });
  });

  describe("movePath", () => {
    it("moves a file", async () => {
      const { state, workspace, sandbox } = fakeSandbox();
      workspace["a.txt"] = new TextEncoder().encode("x");
      expect(
        await new SandboxTools(sandbox).movePath({ source: "a.txt", destination: "d/b.txt" }),
      ).toEqual({ ok: true });
      expect(Object.keys(workspace)).toEqual(["d/b.txt"]);
      expect(state.calls).toEqual([["files.move", "a.txt", "d/b.txt"]]);
    });

    it("makes a missing source an error result", async () => {
      const r = await new SandboxTools(fakeSandbox().sandbox).movePath({
        source: "nope",
        destination: "b",
      });
      expect(r).toEqual({ error: "HTTP 400: nope: no such file" });
    });
  });

  describe("deletePath", () => {
    it("deletes a file", async () => {
      const { state, workspace, sandbox } = fakeSandbox();
      workspace["a.txt"] = new TextEncoder().encode("x");
      expect(await new SandboxTools(sandbox).deletePath({ path: "a.txt" })).toEqual({ ok: true });
      expect(workspace).toEqual({});
      expect(state.calls).toEqual([["files.remove", "a.txt", { recursive: undefined }]]);
    });

    it("deletes a non-empty directory only with recursive: true", async () => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["d/a.txt"] = new TextEncoder().encode("x");
      const tools = new SandboxTools(sandbox);
      expect(await tools.call("delete_path", { path: "d", recursive: null })).toEqual({
        error: "HTTP 400: d: directory not empty",
      });
      expect(await tools.call("delete_path", { path: "d", recursive: false })).toEqual({
        error: "HTTP 400: d: directory not empty",
      });
      expect(await tools.call("delete_path", { path: "d", recursive: true })).toEqual({
        ok: true,
      });
      expect(workspace).toEqual({});
    });

    it("makes a missing path an error result", async () => {
      expect(await new SandboxTools(fakeSandbox().sandbox).deletePath({ path: "nope" })).toEqual({
        error: "HTTP 400: nope: no such file or directory",
      });
    });

    it.each(["yes", 1, 0, {}])(
      "falls back to recursive false for %j on direct calls",
      async (recursive) => {
        const { state, workspace, sandbox } = fakeSandbox();
        workspace["d/a.txt"] = new TextEncoder().encode("x");
        expect(
          await new SandboxTools(sandbox).deletePath({ path: "d", recursive: recursive as never }),
        ).toEqual({ error: "HTTP 400: d: directory not empty" });
        expect(state.calls).toEqual([["files.remove", "d", { recursive: undefined }]]);
      },
    );
  });

  describe("listProcesses", () => {
    it("lists each process with the command it was started with", async () => {
      const { state, sandbox } = fakeSandbox();
      const info = { cwd: "/workspace", startedAt: 1 };
      state.processes = [
        {
          ...info,
          processId: "p1",
          name: "sh",
          args: ["-lc", "npm run dev"],
          state: "running",
          exitCode: null,
        },
        {
          ...info,
          processId: "p2",
          name: "python3",
          args: ["-m", "http.server"],
          state: "exited",
          exitCode: 0,
        },
        { ...info, processId: "p3", name: "sh", args: ["-c", "ls"], state: "exited", exitCode: 2 },
        { ...info, processId: "p4", name: "sleep", args: [], state: "exited", exitCode: null },
      ];
      const tools = new SandboxTools(sandbox, { allowProcesses: true });
      expect(await tools.call("list_processes", {})).toEqual({
        processes: [
          { process_id: "p1", command: "npm run dev", state: "running" },
          { process_id: "p2", command: "python3 -m http.server", state: "exited", exit_code: 0 },
          { process_id: "p3", command: "sh -c ls", state: "exited", exit_code: 2 },
          { process_id: "p4", command: "sleep", state: "exited", exit_code: null },
        ],
      });
      expect(await tools.listProcesses()).toEqual(await tools.call("list_processes", undefined));
    });

    it("returns an empty list", async () => {
      const tools = new SandboxTools(fakeSandbox().sandbox, { allowProcesses: true });
      expect(await tools.listProcesses()).toEqual({ processes: [] });
    });

    it("throws server errors", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new InternalServerError(500, { message: "boom" }, undefined);
      await expect(
        new SandboxTools(sandbox, { allowProcesses: true }).listProcesses(),
      ).rejects.toBeInstanceOf(InternalServerError);
    });
  });

  describe("readFile encoding", () => {
    it("makes a file that is not UTF-8 an error result", async () => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["blob.bin"] = new Uint8Array([0x89, 0x50, 0xff, 0xfe]);
      const r = await new SandboxTools(sandbox).readFile({ path: "blob.bin" });
      expect(r).toEqual({ error: "not UTF-8 text" });
    });
  });

  describe("checkpoint errors", () => {
    it.each([
      ["Snapshot snap-1 failed to capture: disk full.", "checkpoint snap-1 failed: disk full"],
      ["Snapshot snap-1 failed to capture.", "checkpoint snap-1 failed"],
      [
        "Snapshot snap-1 was not Ready within 300000ms (status: Pending).",
        "checkpoint snap-1 not ready after 300 s",
      ],
      ["something else broke", "something else broke"],
    ])("rewords %j", async (message, error) => {
      const { sandbox } = fakeSandbox({ snapshotError: new NeevError(message) });
      expect(await new SandboxTools(sandbox, { allowRollback: true }).checkpoint()).toEqual({
        error,
      });
    });

    // These run the real Sandbox handle, so a reworded SDK wait error fails here.
    function snapshotClient(polls: () => Response) {
      let n = 0;
      const fetch = (async () => {
        n++;
        if (n === 1) return json(201, sandboxData({ phase: "Ready" }));
        if (n === 2) return json(202, snapshotData({ id: "snap-9", status: "Pending" }));
        return polls();
      }) as unknown as typeof globalThis.fetch;
      const neev = new Neev({ apiKey: "k", orgId: "o", projectId: "p", maxRetries: 0, fetch });
      return neev.sandboxes.create({ name: "demo" });
    }

    it("reports a failed capture from the SDK's own wait", async () => {
      const sandbox = await snapshotClient(() =>
        json(200, snapshotData({ id: "snap-9", status: "Failed", error_message: "disk full" })),
      );
      expect(await new SandboxTools(sandbox, { allowRollback: true }).checkpoint()).toEqual({
        error: "checkpoint snap-9 failed: disk full",
      });
    });

    it("reports a capture still pending after 300 s from the SDK's own wait", async () => {
      vi.useFakeTimers();
      try {
        const sandbox = await snapshotClient(() =>
          json(200, snapshotData({ id: "snap-9", status: "Pending" })),
        );
        const result = new SandboxTools(sandbox, { allowRollback: true }).checkpoint();
        await vi.advanceTimersByTimeAsync(301_000);
        expect(await result).toEqual({ error: "checkpoint snap-9 not ready after 300 s" });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("error results", () => {
    it("treats a conflict as recoverable", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new ConflictError(409, { message: "sandbox is paused" }, undefined);
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({
        error: "HTTP 409: sandbox is paused",
      });
    });

    it("cuts a long error by code points, never inside one", async () => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new NeevError("😀".repeat(600));
      const r = (await new SandboxTools(sandbox).runCommand({ command: "ls" })) as {
        error: string;
      };
      expect(r.error).toBe(`${"😀".repeat(500)}…`);
    });
  });

  describe("parity with the Python SDK", () => {
    const all = { allowPreview: true, allowRollback: true, allowProcesses: true };

    interface ApiErrorCase {
      name: string;
      status: number;
      content_type: string;
      body_raw: string;
      request_id?: string;
      expected: string;
    }

    interface CallErrorCase {
      name: string;
      tool: string;
      args: unknown;
      expected: string;
    }

    const shared = fixture("agent_tool_error_texts") as {
      api_errors: ApiErrorCase[];
      call_errors: CallErrorCase[];
    };

    // Answers every request with the case's raw error response.
    function errorFetch(c: ApiErrorCase): typeof globalThis.fetch {
      return (async () =>
        new Response(c.body_raw || null, {
          status: c.status,
          headers: {
            "content-type": c.content_type,
            ...(c.request_id ? { "x-request-id": c.request_id } : {}),
          },
        })) as unknown as typeof globalThis.fetch;
    }

    // The APIError each SDK path raises for the case's raw response.
    async function errorsFor(c: ApiErrorCase): Promise<Record<string, unknown>> {
      const neev = new Neev({
        apiKey: "k",
        orgId: "o",
        projectId: "p",
        maxRetries: 0,
        fetch: errorFetch(c),
      });
      return {
        "typed client": await neev.sandboxes.get("sb-1").catch((e) => e),
        "raw client": await neev.raw.request({ method: "GET", path: "/x" }).catch((e) => e),
        "sandbox runtime": await neev.sandboxes
          .connect("https://sbx.example")
          .files.read("a.txt")
          .catch((e) => e),
      };
    }

    it.each(shared.api_errors)("words the API error case $name", async (c) => {
      for (const [path, err] of Object.entries(await errorsFor(c))) {
        expect(err, path).toBeInstanceOf(APIError);
        expect(shortError(errorText(err as APIError)), path).toBe(c.expected);
      }
    });

    it("reaches the model through a tool with the shared wording", async () => {
      const c = shared.api_errors.find((x) => x.status === 404) as ApiErrorCase;
      const { state, sandbox } = fakeSandbox();
      state.fail = (await errorsFor(c))["sandbox runtime"] as Error;
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({
        error: c.expected,
      });
    });

    it.each(shared.call_errors)("answers the call case $name", async (c) => {
      const { state, sandbox } = fakeSandbox();
      expect(await new SandboxTools(sandbox, all).call(c.tool, c.args)).toEqual({
        error: c.expected,
      });
      expect(state.calls).toEqual([]);
    });

    it.each(["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"])(
      "treats the inherited name %s as an unknown tool",
      async (name) => {
        expect(await new SandboxTools(fakeSandbox().sandbox, all).call(name, {})).toEqual({
          error: `unknown tool: ${name}`,
        });
      },
    );

    it.each([
      [new NotFoundError(404, undefined, "req-1"), "HTTP 404"],
      [new NotFoundError(404, { code: "not_found" }, undefined), "HTTP 404 not_found"],
      [new NotFoundError(404, { message: "no such file" }, undefined), "HTTP 404: no such file"],
      [
        new NotFoundError(404, { code: "not_found", message: "no such file", details: "d" }, "r"),
        "HTTP 404 not_found: no such file",
      ],
      [new BadRequestError(400, { error: "legacy text" }, undefined), "HTTP 400: legacy text"],
      [errorFromSandboxBody(400, "<html>bad</html>\n<body>", "r"), "HTTP 400: <html>bad</html>"],
    ])("words %s as %j", async (err, error) => {
      const { state, sandbox } = fakeSandbox();
      state.fail = err;
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({ error });
    });

    it.each([
      ["\u00a030", 60_000],
      ["\ufeff30", 60_000],
      ["\u0663\u0660", 60_000],
      [" \t30\n\r\f\v", 30_000],
      ["1_000", 60_000],
      ["inf", 60_000],
    ])("reads the numeric string %j as %s ms", async (given, ms) => {
      const { state, sandbox } = fakeSandbox();
      await new SandboxTools(sandbox).runCommand({ command: "ls", timeout_s: given });
      expect(state.calls[0]?.[2]).toMatchObject({ timeoutMs: ms });
    });

    it("rounds seconds to milliseconds half up", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const { sandbox } = fakeSandbox();
      const tools = new SandboxTools(sandbox, all);
      await tools.readProcessOutput({ process_id: "proc-1", wait_s: 0.0005 });
      expect(timeout).toHaveBeenCalledWith(1);
      timeout.mockRestore();
    });

    it("reports an unexpected argument before a missing one", async () => {
      expect(
        await new SandboxTools(fakeSandbox().sandbox).call("write_file", { extra: 1 }),
      ).toEqual({
        error: 'invalid arguments for write_file: got an unexpected keyword argument "extra"',
      });
    });

    it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"])(
      "treats an argument named %s as unexpected",
      async (key) => {
        const args = JSON.parse(`{"path": "a.txt", ${JSON.stringify(key)}: 1}`);
        expect(await new SandboxTools(fakeSandbox().sandbox).call("read_file", args)).toEqual({
          error: `invalid arguments for read_file: got an unexpected keyword argument "${key}"`,
        });
      },
    );

    it.each([
      [{ message: 123 }, "HTTP 400"],
      [{ code: 5, message: "m" }, "HTTP 400: m"],
      [{ message: "", error: "from error" }, "HTTP 400: from error"],
      [{ message: "", error: "", details: "from details" }, "HTTP 400: from details"],
    ])("takes the first non-empty string field of %j", async (body, error) => {
      const { state, sandbox } = fakeSandbox();
      state.fail = new BadRequestError(400, body as never, undefined);
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({ error });
    });

    it.each([
      ["[1,2]", "HTTP 400: [1,2]"],
      ['"oops"', 'HTTP 400: "oops"'],
      ["null", "HTTP 400: null"],
      ["plain text\nmore", "HTTP 400: plain text"],
      ['{"reason_code": "invalid_argument"}', "HTTP 400 invalid_argument"],
    ])("words a sandbox body %j as %j", async (text, error) => {
      const { state, sandbox } = fakeSandbox();
      state.fail = errorFromSandboxBody(400, text, undefined);
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({ error });
    });

    it("keeps a leading byte order mark in output it truncates", async () => {
      const { sandbox } = fakeSandbox({
        execResult: { exitCode: 0, stdout: `\ufeff${"x".repeat(20_000)}`, stderr: "" },
      });
      const r = (await new SandboxTools(sandbox).runCommand({ command: "cat" })) as {
        stdout: string;
      };
      expect(r.stdout.startsWith("\ufeffx")).toBe(true);
    });

    it.each([
      ['\ufeff{"message":"bommed"}', "HTTP 400: bommed"],
      ["\ufeffplain text", "HTTP 400: plain text"],
      ['{"code":5,"reason_code":"invalid_argument","message":"m"}', "HTTP 400 invalid_argument: m"],
    ])("parses the raw body %j without fetch's help", async (text, error) => {
      expect(shortError(errorText(errorFromSandboxBody(400, text, undefined)))).toBe(error);
    });

    it("falls back to reason_code when code is empty", async () => {
      const err = errorFromSandboxBody(
        400,
        '{"code":"","reason_code":"invalid_argument","message":"m"}',
        undefined,
      );
      expect(err.code).toBe("invalid_argument");
      const { state, sandbox } = fakeSandbox();
      state.fail = err;
      expect(await new SandboxTools(sandbox).runCommand({ command: "ls" })).toEqual({
        error: "HTTP 400 invalid_argument: m",
      });
    });

    it("keeps a leading byte order mark in a file", async () => {
      const { workspace, sandbox } = fakeSandbox();
      workspace["bom.txt"] = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
      expect(await new SandboxTools(sandbox).readFile({ path: "bom.txt" })).toEqual({
        content: "\ufeffhi",
      });
    });

    it("quotes an unexpected argument name as JSON", async () => {
      const r = await new SandboxTools(fakeSandbox().sandbox).call("read_file", {
        path: "a",
        'we"ird': 1,
      });
      expect(r).toEqual({
        error: 'invalid arguments for read_file: got an unexpected keyword argument "we\\"ird"',
      });
    });

    it("caps a long call() error at 500 characters", async () => {
      const r = (await new SandboxTools(fakeSandbox().sandbox).call("x".repeat(600), {})) as {
        error: string;
      };
      expect(Array.from(r.error)).toHaveLength(501);
      expect(r.error.endsWith("…")).toBe(true);
    });
  });
});
