import { describe, expect, it } from "vitest";
import { Neev, NeevError, NotFoundError, Sandbox } from "../src/index.js";
import { json, mockFetch, sandboxData, snapshotData } from "./helpers.js";

// Builds a client backed by the given queued responses.
function client(queue: Array<Response | Error>) {
  const mock = mockFetch(queue);
  return {
    neev: new Neev({
      apiKey: "k",
      orgId: "org_test",
      projectId: "proj_test",
      maxRetries: 0,
      fetch: mock.fetch,
    }),
    calls: mock.calls,
  };
}

describe("sandboxes resource", () => {
  it("creates a sandbox from a template and returns a handle", async () => {
    const { neev, calls } = client([json(201, sandboxData({ name: "demo" }))]);
    const sb = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    expect(sb).toBeInstanceOf(Sandbox);
    expect(sb.name).toBe("demo");
    expect(sb.templateId).toBe("sb-ubuntu-26-04-minimal");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/api/v1beta1/orgs/org_test/projects/proj_test/sandboxes");
    expect(calls[0]?.body).toEqual({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
  });

  it("allowInternet translates to a full-open egress policy", async () => {
    const { neev, calls } = client([json(201, sandboxData({ name: "web" }))]);
    await neev.sandboxes.create({ name: "web", sandbox_template_id: "sb-x", allowInternet: true });
    // The gate alone is a server-side no-op, so the 0.0.0.0/0 + ::/0 routes must ride along.
    expect(calls[0]?.body).toEqual({
      name: "web",
      sandbox_template_id: "sb-x",
      egress: {
        mode: "allow_list",
        allow_internet: true,
        allow: [{ host: "0.0.0.0/0" }, { host: "::/0" }],
      },
    });
  });

  it("allowEgress translates to an allow-list of hosts, no internet gate", async () => {
    const { neev, calls } = client([json(201, sandboxData({ name: "ci" }))]);
    await neev.sandboxes.create({
      name: "ci",
      sandbox_template_id: "sb-x",
      allowEgress: ["github.com", "*.npmjs.org"],
    });
    expect(calls[0]?.body).toEqual({
      name: "ci",
      sandbox_template_id: "sb-x",
      egress: {
        mode: "allow_list",
        allow_internet: false,
        allow: [{ host: "github.com" }, { host: "*.npmjs.org" }],
      },
    });
  });

  it("an explicit egress wins, and the convenience fields are stripped from the body", async () => {
    const { neev, calls } = client([json(201, sandboxData({ name: "adv" }))]);
    await neev.sandboxes.create({
      name: "adv",
      sandbox_template_id: "sb-x",
      allowInternet: true,
      egress: { mode: "deny_all", allow_internet: false },
    });
    expect(calls[0]?.body).toEqual({
      name: "adv",
      sandbox_template_id: "sb-x",
      egress: { mode: "deny_all", allow_internet: false },
    });
  });

  it("lists sandboxes with pagination and wraps items as handles", async () => {
    const { neev, calls } = client([
      json(200, {
        items: [sandboxData(), sandboxData({ id: "22222222-2222-2222-2222-222222222222" })],
        total: 2,
        page: 1,
        limit: 20,
      }),
    ]);
    const page = await neev.sandboxes.list({ page: 1, limit: 20 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toBeInstanceOf(Sandbox);
    expect(calls[0]?.url).toContain("page=1");
    expect(calls[0]?.url).toContain("limit=20");
  });

  it("forwards the name, status, and sandboxId filters as query params", async () => {
    const { neev, calls } = client([json(200, { items: [], total: 0, page: 1, limit: 20 })]);
    await neev.sandboxes.list({ name: "web", status: "Paused", sandboxId: "sb-1" });
    const url = calls[0]?.url ?? "";
    expect(url).toContain("name=web");
    expect(url).toContain("status=Paused");
    expect(url).toContain("sandbox_id=sb-1");
  });

  it("omits filter query params when they are unset", async () => {
    const { neev, calls } = client([json(200, { items: [], total: 0, page: 1, limit: 20 })]);
    await neev.sandboxes.list();
    const url = calls[0]?.url ?? "";
    expect(url).not.toContain("name=");
    expect(url).not.toContain("status=");
    expect(url).not.toContain("sandbox_id=");
  });

  it("targets the pause and resume sub-paths", async () => {
    const { neev, calls } = client([
      json(200, sandboxData({ phase: "Paused", replicas: 0 })),
      json(200, sandboxData({ phase: "Ready", replicas: 1 })),
    ]);
    const paused = await neev.sandboxes.pause("sb-1");
    expect(paused.phase).toBe("Paused");
    expect(calls[0]?.url).toMatch(/\/sandboxes\/sb-1\/pause$/);

    const resumed = await neev.sandboxes.resume("sb-1");
    expect(resumed.phase).toBe("Ready");
    expect(calls[1]?.url).toMatch(/\/sandboxes\/sb-1\/resume$/);
  });

  it("reads metrics with the query window", async () => {
    const { neev, calls } = client([
      json(200, {
        sandbox_id: "sb-1",
        from: "2026-06-05T00:00:00Z",
        to: "2026-06-05T01:00:00Z",
        step: "60s",
        series: [],
      }),
    ]);
    const metrics = await neev.sandboxes.metrics("sb-1", { step: "60s" });
    expect(metrics.sandbox_id).toBe("sb-1");
    expect(calls[0]?.url).toMatch(/\/sandboxes\/sb-1\/metrics\?step=60s$/);
  });

  it("throws a typed error from the openapi-fetch client on a 404", async () => {
    const { neev } = client([
      json(404, { error: "not_found", details: "gone" }, { "x-request-id": "r1" }),
    ]);
    const err = await neev.sandboxes.get("missing").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
    expect((err as NotFoundError).requestId).toBe("r1");
  });

  it("applies a per-call scope override", async () => {
    const { neev, calls } = client([json(200, sandboxData())]);
    await neev.sandboxes.get("sb-1", { orgId: "other_org", projectId: "other_proj" });
    expect(calls[0]?.url).toContain("/orgs/other_org/projects/other_proj/");
  });

  it("exposes region, template id, and resources on the handle", async () => {
    const { neev } = client([
      json(
        200,
        sandboxData({
          region: "dev",
          sandbox_template_id: "sb-ubuntu-26-04-minimal",
          resources: { cpu: 2, memory_gb: 4, disk_gb: 20 },
        }),
      ),
    ]);
    const sb = await neev.sandboxes.get("sb-1");
    expect(sb.region).toBe("dev");
    expect(sb.templateId).toBe("sb-ubuntu-26-04-minimal");
    expect(sb.resources).toEqual({ cpu: 2, memory_gb: 4, disk_gb: 20 });
  });

  it("reports null template id when the server omits it", async () => {
    const { neev } = client([json(200, sandboxData({ sandbox_template_id: null }))]);
    const sb = await neev.sandboxes.get("sb-1");
    expect(sb.templateId).toBeNull();
    expect(sb.resources).toBeUndefined();
  });
});

describe("sandbox snapshots, rollback, and fork", () => {
  it("creates a snapshot and posts the request body", async () => {
    const { neev, calls } = client([json(202, snapshotData({ name: "snap-1" }))]);
    const snap = await neev.sandboxes.createSnapshot("sb-1", { name: "snap-1" });
    expect(snap.id).toBe("22222222-2222-2222-2222-222222222222");
    expect(snap.status).toBe("Pending");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/sandboxes/sb-1/snapshots");
    // The caller passes only user-facing fields; the SDK fills the rest.
    expect(calls[0]?.body).toEqual({ name: "snap-1" });
  });

  it("lists the snapshots of a sandbox", async () => {
    const { neev, calls } = client([
      json(200, {
        items: [snapshotData(), snapshotData({ id: "snap-b" })],
        total: 2,
        page: 1,
        limit: 50,
      }),
    ]);
    const page = await neev.sandboxes.listSnapshots("sb-1", { page: 2, limit: 10 });
    // The paged response preserves total/page/limit so callers can page through all.
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.items.map((s) => s.id)).toEqual(["22222222-2222-2222-2222-222222222222", "snap-b"]);
    expect(calls[0]?.url).toContain("/sandboxes/sb-1/snapshots");
    expect(calls[0]?.url).toContain("page=2");
    expect(calls[0]?.url).toContain("limit=10");
  });

  it("gets and deletes a snapshot by id", async () => {
    const { neev, calls } = client([
      json(200, snapshotData({ status: "Ready" })),
      json(204, undefined),
    ]);
    const snap = await neev.sandboxes.getSnapshot("snap-x");
    expect(snap.status).toBe("Ready");
    expect(calls[0]?.url).toContain("/snapshots/snap-x");
    await neev.sandboxes.deleteSnapshot("snap-x");
    expect(calls[1]?.method).toBe("DELETE");
    expect(calls[1]?.url).toContain("/snapshots/snap-x");
  });

  it("throws a typed error when a snapshot is not found", async () => {
    const { neev } = client([json(404, { error: "not_found", details: "gone" })]);
    const err = await neev.sandboxes.getSnapshot("missing").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
  });

  it("rolls a sandbox back in place to a snapshot", async () => {
    const { neev, calls } = client([json(200, sandboxData({ phase: "Pending" }))]);
    const rolledBack = await neev.sandboxes.rollback("sb-1", "snap-x");
    expect(rolledBack).toBeInstanceOf(Sandbox);
    expect(rolledBack.phase).toBe("Pending"); // handle hydrated from the response
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/sandboxes/sb-1/rollback");
    expect(calls[0]?.body).toEqual({ snapshot_id: "snap-x" });
  });

  it("forks a sandbox into a new named sandbox", async () => {
    const { neev, calls } = client([json(201, sandboxData({ name: "forked" }))]);
    const fork = await neev.sandboxes.fork("sb-1", "forked");
    expect(fork).toBeInstanceOf(Sandbox);
    expect(fork.name).toBe("forked");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/sandboxes/sb-1/fork");
    expect(calls[0]?.body).toEqual({ name: "forked" });
  });

  it("exposes snapshot/snapshots/rollback/fork on the Sandbox handle", async () => {
    const { neev, calls } = client([
      json(200, sandboxData()), // get
      json(202, snapshotData()), // snapshot
      json(200, { items: [snapshotData()], total: 1, page: 1, limit: 50 }), // snapshots (list)
      json(200, sandboxData({ phase: "Pending" })), // rollback
      json(201, sandboxData({ name: "child" })), // fork
    ]);
    const sb = await neev.sandboxes.get("sb-1");
    await sb.snapshot();
    const snaps = await sb.snapshots();
    expect(snaps.items).toHaveLength(1);
    await sb.rollback("snap-x");
    const child = await sb.fork("child");
    expect(child.name).toBe("child");
    expect(calls.map((c) => c.url.split("/").pop())).toEqual([
      "sb-1",
      "snapshots",
      "snapshots",
      "rollback",
      "fork",
    ]);
  });

  it("waitForSnapshot polls getSnapshot until the snapshot is Ready", async () => {
    const { neev, calls } = client([
      json(200, snapshotData({ status: "Pending" })),
      json(200, snapshotData({ status: "Running" })),
      json(200, snapshotData({ status: "Ready", size_bytes: 4096 })),
    ]);
    const snap = await neev.sandboxes.waitForSnapshot("snap-1", {
      pollIntervalMs: 1,
      timeoutMs: 1000,
    });
    expect(snap.status).toBe("Ready");
    expect(snap.size_bytes).toBe(4096);
    // One GET per poll until Ready, all against the snapshot item route.
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.method).toBe("GET");
      expect(call.url).toContain("/snapshots/snap-1");
    }
  });

  it("waitForSnapshot throws with the error message when the snapshot fails", async () => {
    const { neev } = client([
      json(200, snapshotData({ status: "Failed", error_message: "disk full" })),
    ]);
    await expect(
      neev.sandboxes.waitForSnapshot("snap-1", { pollIntervalMs: 1, timeoutMs: 1000 }),
    ).rejects.toThrow(/disk full/);
  });

  it("waitForSnapshot throws when it never becomes Ready before the timeout", async () => {
    // A fetch that always reports Pending, so the poll loop can only time out.
    const neev = new Neev({
      apiKey: "k",
      orgId: "org_test",
      projectId: "proj_test",
      maxRetries: 0,
      fetch: async () => json(200, snapshotData({ status: "Pending" })),
    });
    await expect(
      neev.sandboxes.waitForSnapshot("snap-1", { pollIntervalMs: 1, timeoutMs: 10 }),
    ).rejects.toThrow(NeevError);
  });

  it("waitForSnapshot rejects a non-positive timeout before polling", async () => {
    const { neev, calls } = client([]);
    await expect(neev.sandboxes.waitForSnapshot("snap-1", { timeoutMs: 0 })).rejects.toThrow(
      /timeoutMs/,
    );
    expect(calls).toHaveLength(0);
  });

  it("sandbox.snapshot({ waitUntilReady: true }) resolves with the Ready snapshot", async () => {
    const { neev, calls } = client([
      json(200, sandboxData()), // get
      json(202, snapshotData({ status: "Pending" })), // createSnapshot
      json(200, snapshotData({ status: "Ready" })), // waitForSnapshot poll
    ]);
    const sb = await neev.sandboxes.get("sb-1");
    const snap = await sb.snapshot({ name: "snap-a", waitUntilReady: true, pollIntervalMs: 1 });
    expect(snap.status).toBe("Ready");
    // The create body carries only the request fields, not the wait controls.
    expect(calls[1]?.body).toEqual({ name: "snap-a" });
    expect(calls[2]?.url).toContain("/snapshots/");
  });

  it("sandbox.snapshot() without waitUntilReady returns Pending without polling", async () => {
    const { neev, calls } = client([
      json(200, sandboxData()), // get
      json(202, snapshotData({ status: "Pending" })), // createSnapshot
    ]);
    const sb = await neev.sandboxes.get("sb-1");
    const snap = await sb.snapshot();
    expect(snap.status).toBe("Pending");
    // Only get + create — no follow-up getSnapshot poll.
    expect(calls).toHaveLength(2);
  });
});

describe("preview ports", () => {
  it("exposes a port and returns it with its preview URL", async () => {
    const { neev, calls } = client([
      json(200, { port: 3000, preview_url: "https://p.example/app" }),
    ]);
    const p = await neev.sandboxes.exposePort("sb-1", 3000);
    expect(p).toEqual({ port: 3000, preview_url: "https://p.example/app" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toMatch(/\/sandboxes\/sb-1\/ports$/);
    expect(calls[0]?.body).toEqual({ port: 3000 });
  });

  it("lists exposed ports", async () => {
    const { neev, calls } = client([
      json(200, { ports: [{ port: 3000, preview_url: "https://p.example/a" }] }),
    ]);
    const ports = await neev.sandboxes.listPorts("sb-1");
    expect(ports).toHaveLength(1);
    expect(ports[0]?.port).toBe(3000);
    expect(calls[0]?.url).toMatch(/\/sandboxes\/sb-1\/ports$/);
  });

  it("revokes a port by number", async () => {
    const { neev, calls } = client([new Response(null, { status: 204 })]);
    await neev.sandboxes.revokePort("sb-1", 3000);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toMatch(/\/sandboxes\/sb-1\/ports\/3000$/);
  });

  it("getPortUrl without waiting returns the URL after a single expose call", async () => {
    const { neev, calls } = client([
      json(200, { port: 3000, preview_url: "https://p.example/app" }),
    ]);
    const url = await neev.sandboxes.getPortUrl("sb-1", 3000, { waitUntilReady: false });
    expect(url).toBe("https://p.example/app");
    expect(calls).toHaveLength(1); // expose only — no readiness probe
  });

  it("getPortUrl polls the preview URL until the gateway routes it", async () => {
    const { neev, calls } = client([
      json(200, { port: 3000, preview_url: "https://p.example/app" }),
      new Response(null, { status: 404 }), // route not provisioned yet
      new Response(null, { status: 502 }), // routed — nothing listening yet, but reachable
    ]);
    const url = await neev.sandboxes.getPortUrl("sb-1", 3000, {
      pollIntervalMs: 1,
      timeoutMs: 5000,
    });
    expect(url).toBe("https://p.example/app");
    expect(calls).toHaveLength(3);
    expect(calls[1]?.url).toBe("https://p.example/app"); // probed the preview URL itself
    expect(calls[1]?.method).toBe("GET");
  });

  it("getPortUrl throws when the preview URL never becomes routable", async () => {
    const notReady = Array.from({ length: 20 }, () => new Response(null, { status: 404 }));
    const { neev } = client([
      json(200, { port: 3000, preview_url: "https://p.example/app" }),
      ...notReady,
    ]);
    await expect(
      neev.sandboxes.getPortUrl("sb-1", 3000, { pollIntervalMs: 1, timeoutMs: 15 }),
    ).rejects.toThrow(/not routable/);
  });

  it("getPortUrl aborts a stalled probe so the timeout budget is honored", async () => {
    // The expose call returns normally; the readiness probe stalls until aborted.
    let probeAborted = false;
    const urlOf = (input: RequestInfo | URL): string =>
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (urlOf(input).endsWith("/ports")) {
        return json(200, { port: 3000, preview_url: "https://p.example/app" });
      }
      // The readiness probe: never resolve until its abort signal fires.
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          probeAborted = true;
          reject(new Error("aborted"));
        });
      });
    }) as typeof fetch;
    const neev = new Neev({
      apiKey: "k",
      orgId: "o",
      projectId: "p",
      maxRetries: 0,
      fetch: fetchImpl,
    });
    await expect(
      neev.sandboxes.getPortUrl("sb-1", 3000, { pollIntervalMs: 5, timeoutMs: 30 }),
    ).rejects.toThrow(/not routable/);
    expect(probeAborted).toBe(true);
  });

  it("sandbox.getUrl delegates through the handle", async () => {
    const { neev, calls } = client([
      json(200, sandboxData({ id: "sb-1", phase: "Ready" })),
      json(200, { port: 8080, preview_url: "https://p.example/ui" }),
    ]);
    const sandbox: Sandbox = await neev.sandboxes.get("sb-1");
    const url = await sandbox.getUrl({ port: 8080, waitUntilReady: false });
    expect(url).toBe("https://p.example/ui");
    expect(calls[1]?.body).toEqual({ port: 8080 });
  });
});
