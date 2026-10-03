import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APIError,
  APITimeoutError,
  CodeResult,
  Neev,
  NeevError,
  type OutputMessage,
  PreconditionFailedError,
} from "../src/index.js";
import { json, mockFetch, sandboxData } from "./helpers.js";

// Builds a Ready sandbox handle, queueing the create response plus the runtime responses.
async function readySandbox(daemonQueue: Array<Response | Error>) {
  const mock = mockFetch([
    json(201, sandboxData({ connect_url: "https://sbx.example", phase: "Ready" })),
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
    sandbox_template_id: "sb-ubuntu-26-04-interpreter",
  });
  return { sandbox, calls: mock.calls };
}

// Advances fake time until p settles, yielding to the real event loop between steps.
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  p.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  while (!done) {
    await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(500);
  }
  return p;
}

// Builds an NDJSON run Response from a list of events.
function ndjson(events: unknown[]): Response {
  return new Response(events.map((e) => JSON.stringify(e)).join("\n"), { status: 200 });
}

describe("code", () => {
  describe("run", () => {
    it("success: collects output and calls back as it arrives", async () => {
      const { sandbox, calls } = await readySandbox([
        ndjson([
          { type: "stream", name: "stdout", text: "4" },
          { type: "keepalive" },
          { type: "stream", name: "stdout", text: "2\n" },
          { type: "stream", name: "stderr", text: "warn\n" },
          { type: "result", data: { "text/plain": "84" }, is_main: true },
          { type: "end", reason: "ok", generation: "g1", execution_count: 3 },
        ]),
      ]);
      const seen: OutputMessage[] = [];
      const results: CodeResult[] = [];
      const run = await sandbox.code.run("print(42)\nx * 2", {
        context: { contextId: "ctx-1" },
        timeoutMs: 5000,
        envs: { MODE: "test" },
        onStdout: (m) => seen.push(m),
        onResult: (r) => results.push(r),
      });

      expect(run).toEqual({
        stdout: "42\n",
        stderr: "warn\n",
        logs: { stdout: ["4", "2\n"], stderr: ["warn\n"] },
        results: [{ data: { "text/plain": "84" }, isMain: true }],
        text: "84",
        endReason: "ok",
        executionCount: 3,
        generation: "g1",
        truncated: false,
      });
      expect(seen.map((m) => [m.line, m.error])).toEqual([
        ["4", false],
        ["2\n", false],
      ]);
      expect(typeof seen[0]?.timestamp).toBe("number");
      expect(results[0]).toBeInstanceOf(CodeResult);
      expect(calls[1]?.url).toBe("https://sbx.example/v1/interpreter/run");
      expect(calls[1]?.headers.get("authorization")).toBe("Bearer k");
      expect(calls[1]?.headers.get("prefer")).toBe("wait=0");
      expect(calls[1]?.body).toEqual({
        code: "print(42)\nx * 2",
        context_id: "ctx-1",
        timeout_ms: 5000,
        envs: { MODE: "test" },
      });
    });

    it("success: code that raises is returned, not thrown", async () => {
      const { sandbox } = await readySandbox([
        ndjson([
          {
            type: "error",
            name: "ZeroDivisionError",
            value: "division by zero",
            traceback: ["tb"],
          },
          { type: "end", reason: "error", generation: "g1" },
        ]),
      ]);
      const run = await sandbox.code.run("1/0");
      expect(run.endReason).toBe("error");
      expect(run.error).toEqual({
        name: "ZeroDivisionError",
        value: "division by zero",
        traceback: ["tb"],
      });
    });

    it("failure: a busy context throws with its reason", async () => {
      const { sandbox } = await readySandbox([
        json(412, {
          reason_code: "failed_precondition",
          reason: "context_busy",
          message: "the context is running a cell or starting; retry when it is idle",
        }),
      ]);
      const err = await sandbox.code.run("1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PreconditionFailedError);
      expect((err as PreconditionFailedError).reason).toBe("context_busy");
    });

    it("failure: a stream without an end throws", async () => {
      const { sandbox } = await readySandbox([
        ndjson([{ type: "stream", name: "stdout", text: "a" }]),
      ]);
      await expect(sandbox.code.run("1")).rejects.toBeInstanceOf(NeevError);
    });
  });

  describe("options", () => {
    it("success: result accessors read the common MIME types", () => {
      const r = new CodeResult(
        { "text/plain": "<Figure>", "image/png": "iVBOR", "application/json": { a: 1 } },
        true,
      );
      expect(r.formats()).toEqual(["text/plain", "image/png", "application/json"]);
      expect([r.text, r.png, r.html]).toEqual(["<Figure>", "iVBOR", undefined]);
      expect(r.json).toEqual({ a: 1 });
    });

    it("failure: a language other than python is refused before any request", async () => {
      const { sandbox, calls } = await readySandbox([]);
      await expect(sandbox.code.run("1", { language: "r" })).rejects.toBeInstanceOf(NeevError);
      await expect(
        sandbox.code.run("1", { language: "python", context: "c" }),
      ).rejects.toBeInstanceOf(NeevError);
      expect(calls).toHaveLength(1);
    });

    it("failure: requestTimeoutMs aborts a run that outlasts it", async () => {
      const mock = mockFetch([
        json(201, sandboxData({ connect_url: "https://sbx.example", phase: "Ready" })),
      ]);
      const neev = new Neev({
        apiKey: "k",
        orgId: "org_test",
        projectId: "proj_test",
        fetch: async (input, init) => {
          if (String(input instanceof Request ? input.url : input).includes("/interpreter/")) {
            // fetch(input, init) honours init.signal over the request's own, as the dispatcher relies on.
            const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
            return new Promise<Response>((_, reject) => {
              if (signal?.aborted) reject(signal.reason);
              signal?.addEventListener("abort", () => reject(signal.reason));
            });
          }
          return mock.fetch(input, init);
        },
      });
      const sandbox = await neev.sandboxes.create({
        name: "demo",
        sandbox_template_id: "sb-ubuntu-26-04-interpreter",
      });
      await expect(sandbox.code.run("1", { requestTimeoutMs: 50 })).rejects.toBeInstanceOf(
        APITimeoutError,
      );
    });
  });

  describe("waking", () => {
    const waking = () =>
      json(503, {
        reason_code: "unavailable",
        reason: "sandbox_waking",
        message: "the sandbox is waking; retry shortly",
      });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("success: a run is retried until the sandbox is awake", async () => {
      const { sandbox, calls } = await readySandbox([
        waking(),
        waking(),
        ndjson([{ type: "end", reason: "ok", generation: "g1" }]),
      ]);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      expect((await settle(sandbox.code.run("1"))).endReason).toBe("ok");
      expect(calls).toHaveLength(4);
    });

    it("success: a context call is retried the same way", async () => {
      const { sandbox, calls } = await readySandbox([
        waking(),
        json(200, { context_id: "c1", generation: "g1", language: "python", cwd: "/w" }),
      ]);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      expect((await settle(sandbox.code.createContext())).contextId).toBe("c1");
      expect(calls).toHaveLength(3);
      expect(calls[1]?.headers.get("prefer")).toBe("wait=0");
    });

    it("failure: requestTimeoutMs ends the wait", async () => {
      const { sandbox } = await readySandbox([waking(), waking(), waking()]);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const run = sandbox.code.run("1", { requestTimeoutMs: 3000 }).catch((e: unknown) => e);
      expect(await settle(run)).toBeInstanceOf(APITimeoutError);
    });

    it("failure: another 503 is not retried", async () => {
      const { sandbox, calls } = await readySandbox([
        json(503, { reason_code: "unavailable", message: "interpreter starting" }),
      ]);
      const err = await sandbox.code.run("1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).status).toBe(503);
      expect(calls).toHaveLength(2);
    });
  });

  describe("contexts", () => {
    it("success: create, list, restart and delete", async () => {
      const { sandbox, calls } = await readySandbox([
        json(200, {
          context_id: "ctx-1",
          generation: "g1",
          language: "python",
          cwd: "/workspace/proj",
        }),
        json(200, {
          contexts: [{ context_id: "default", state: "busy", generation: "g0", rss_mib: 120 }],
        }),
        json(200, { generation: "g2" }),
        json(200, {}),
      ]);

      expect(await sandbox.code.createContext({ cwd: "proj" })).toEqual({
        contextId: "ctx-1",
        generation: "g1",
        language: "python",
        cwd: "/workspace/proj",
      });
      expect(await sandbox.code.listContexts()).toEqual([
        { contextId: "default", state: "busy", generation: "g0", rssMib: 120 },
      ]);
      expect(await sandbox.code.restartContext("default")).toBe("g2");
      await sandbox.code.deleteContext({ contextId: "ctx-1" });

      expect(calls.slice(1).map((c) => [c.url, c.body])).toEqual([
        ["https://sbx.example/v1/interpreter/contexts/create", { cwd: "proj" }],
        ["https://sbx.example/v1/interpreter/contexts/list", {}],
        ["https://sbx.example/v1/interpreter/contexts/restart", { context_id: "default" }],
        ["https://sbx.example/v1/interpreter/contexts/delete", { context_id: "ctx-1" }],
      ]);
    });
  });
});
