import { describe, expect, it } from "vitest";
import {
  Agent,
  ConflictError,
  Neev,
  NeevError,
  NotFoundError,
  TooEarlyError,
} from "../src/index.js";
import { agentData, auditEvent, json, mockFetch, snapshotData } from "./helpers.js";

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

describe("agents resource", () => {
  it("creates an agent from a template and returns a handle", async () => {
    const { neev, calls } = client([json(201, agentData({ name: "demo" }))]);
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });
    expect(agent).toBeInstanceOf(Agent);
    expect(agent.name).toBe("demo");
    expect(agent.templateId).toBe("ag-claude-code");
    expect(agent.status).toBe("Provisioning");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/api/v1beta1/orgs/org_test/projects/proj_test/agents");
    expect(calls[0]?.body).toEqual({ name: "demo", agent_template: "claude-code" });
  });

  it("allowInternet translates to a full-open egress policy on agent create", async () => {
    const { neev, calls } = client([json(201, agentData({ name: "web" }))]);
    await neev.agents.create({ name: "web", agent_template: "claude-code", allowInternet: true });
    expect(calls[0]?.body).toEqual({
      name: "web",
      agent_template: "claude-code",
      egress: {
        mode: "allow_list",
        allow_internet: true,
        allow: [{ host: "0.0.0.0/0" }, { host: "::/0" }],
      },
    });
  });

  it("allowEgress translates to an allow-list on agent create, and strips the field", async () => {
    const { neev, calls } = client([json(201, agentData({ name: "ci" }))]);
    await neev.agents.create({
      name: "ci",
      agent_template: "claude-code",
      allowEgress: ["github.com"],
    });
    expect(calls[0]?.body).toEqual({
      name: "ci",
      agent_template: "claude-code",
      egress: { mode: "allow_list", allow_internet: false, allow: [{ host: "github.com" }] },
    });
  });

  it("lists agents with pagination and wraps items as handles", async () => {
    const { neev, calls } = client([
      json(200, {
        items: [agentData(), agentData({ id: "44444444-4444-4444-4444-444444444444" })],
        total: 2,
        page: 1,
        limit: 20,
      }),
    ]);
    const page = await neev.agents.list({ page: 1, limit: 20 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toBeInstanceOf(Agent);
    expect(calls[0]?.url).toContain("page=1");
    expect(calls[0]?.url).toContain("limit=20");
  });

  it("fetches a single agent by id", async () => {
    const { neev, calls } = client([json(200, agentData())]);
    const agent = await neev.agents.get("ag-1");
    expect(agent.id).toBe("33333333-3333-3333-3333-333333333333");
    expect(calls[0]?.url).toMatch(/\/agents\/ag-1$/);
  });

  it("patches an agent in place", async () => {
    const { neev, calls } = client([json(200, agentData({ status: "Ready" }))]);
    const agent = await neev.agents.update("ag-1", { resources: { cpu: 2, memory_gb: 4 } });
    expect(agent.data.config).toBeUndefined();
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toMatch(/\/agents\/ag-1$/);
    expect(calls[0]?.body).toEqual({ resources: { cpu: 2, memory_gb: 4 } });
  });

  it("rejects an empty update locally without issuing a request", async () => {
    const { neev, calls } = client([]);
    await expect(neev.agents.update("ag-1", {})).rejects.toBeInstanceOf(NeevError);
    expect(calls).toHaveLength(0);
  });

  it("maps the egress convenience on update the same way create does", async () => {
    const { neev, calls } = client([json(200, agentData({ status: "Ready" }))]);
    await neev.agents.update("ag-1", { allowEgress: ["github.com"] });
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toEqual({
      egress: {
        mode: "allow_list",
        allow_internet: false,
        allow: [{ host: "github.com" }],
      },
    });
  });

  it("sends resources and egress together in one PATCH", async () => {
    const { neev, calls } = client([json(200, agentData({ status: "Ready" }))]);
    await neev.agents.update("ag-1", {
      resources: { cpu: 2, memory_gb: 4 },
      allowInternet: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      resources: { cpu: 2, memory_gb: 4 },
      egress: {
        mode: "allow_list",
        allow_internet: true,
        allow: [{ host: "0.0.0.0/0" }, { host: "::/0" }],
      },
    });
  });

  it("targets the pause and resume sub-paths", async () => {
    const { neev, calls } = client([
      json(200, agentData({ status: "Paused" })),
      json(200, agentData({ status: "Ready" })),
    ]);
    const paused = await neev.agents.pause("ag-1");
    expect(paused.status).toBe("Paused");
    expect(calls[0]?.url).toMatch(/\/agents\/ag-1\/pause$/);

    const resumed = await neev.agents.resume("ag-1");
    expect(resumed.status).toBe("Ready");
    expect(calls[1]?.url).toMatch(/\/agents\/ag-1\/resume$/);
  });

  it("deletes an agent with no body", async () => {
    const { neev, calls } = client([json(204, undefined)]);
    await neev.agents.delete("ag-1");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toMatch(/\/agents\/ag-1$/);
  });

  it("throws a typed error when an agent is missing", async () => {
    const { neev } = client([json(404, { error: "not_found", details: "no such agent" })]);
    const err = await neev.agents.get("ag-missing").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
  });

  it("honors a per-call scope override", async () => {
    const { neev, calls } = client([json(200, agentData())]);
    await neev.agents.get("ag-1", { orgId: "org_other", projectId: "proj_other" });
    expect(calls[0]?.url).toContain("/orgs/org_other/projects/proj_other/agents/ag-1");
  });
});

describe("agent idle window and in-place egress edits", () => {
  it("passes idle_timeout_seconds through on create", async () => {
    const { neev, calls } = client([json(201, agentData({ idle_timeout_seconds: 900 }))]);
    const agent = await neev.agents.create({
      name: "demo",
      agent_template: "claude-code",
      idle_timeout_seconds: 900,
    });
    expect(calls[0]?.body).toEqual({
      name: "demo",
      agent_template: "claude-code",
      idle_timeout_seconds: 900,
    });
    expect(agent.idleTimeoutSeconds).toBe(900);
  });

  it("reports null for the account default and 0 for no idle limit", async () => {
    const { neev } = client([
      json(200, agentData({ idle_timeout_seconds: null })),
      json(200, agentData({ idle_timeout_seconds: 0 })),
    ]);
    expect((await neev.agents.get("ag-1")).idleTimeoutSeconds).toBeNull();
    expect((await neev.agents.get("ag-1")).idleTimeoutSeconds).toBe(0);
  });

  it("accepts idle_timeout_seconds alone on update", async () => {
    const { neev, calls } = client([json(200, agentData({ idle_timeout_seconds: 0 }))]);
    await neev.agents.update("ag-1", { idle_timeout_seconds: 0 });
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toEqual({ idle_timeout_seconds: 0 });
  });

  it("edits the allow-list in place with egress_add / egress_remove", async () => {
    const { neev, calls } = client([json(200, agentData())]);
    await neev.agents.update("ag-1", {
      egress_remove: { allow: [{ host: "old.example.com" }] },
      egress_add: { allow: [{ host: "api.github.com", ports: [443], protocol: "TCP" }] },
    });
    expect(calls[0]?.body).toEqual({
      egress_remove: { allow: [{ host: "old.example.com" }] },
      egress_add: { allow: [{ host: "api.github.com", ports: [443], protocol: "TCP" }] },
    });
  });

  it("rejects egress combined with egress_add/egress_remove locally", async () => {
    const { neev, calls } = client([]);
    await expect(
      neev.agents.update("ag-1", {
        allowInternet: true,
        egress_add: { allow: [{ host: "a.example.com" }] },
      }),
    ).rejects.toThrow(/cannot be combined/);
    expect(calls).toHaveLength(0);
  });

  it("names every accepted field when an update is empty", async () => {
    const { neev } = client([]);
    await expect(neev.agents.update("ag-1", {})).rejects.toThrow(
      /`resources`, `egress`, `egress_add`, `egress_remove` or `idle_timeout_seconds`/,
    );
  });
});

describe("agent keepalive and rollback", () => {
  it("keepalive posts to the agent keepalive path and refreshes the handle", async () => {
    const { neev, calls } = client([
      json(200, agentData({ status: "Ready" })),
      json(200, agentData({ status: "Ready", idle_timeout_seconds: 600 })),
    ]);
    const agent = await neev.agents.get("ag-1");
    await agent.keepalive();
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toMatch(/\/agents\/33333333-3333-3333-3333-333333333333\/keepalive$/);
    expect(calls[1]?.body).toBeUndefined();
    expect(agent.idleTimeoutSeconds).toBe(600);
  });

  it("rollback posts the snapshot id to the agent rollback path", async () => {
    const { neev, calls } = client([json(200, agentData())]);
    const agent = await neev.agents.rollback("ag-1", "22222222-2222-2222-2222-222222222222");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toMatch(/\/agents\/ag-1\/rollback$/);
    expect(calls[0]?.body).toEqual({ snapshot_id: "22222222-2222-2222-2222-222222222222" });
    expect(agent).toBeInstanceOf(Agent);
  });

  it("the handle's rollback targets its own id", async () => {
    const { neev, calls } = client([json(200, agentData()), json(200, agentData())]);
    const agent = await neev.agents.get("ag-1");
    await agent.rollback("snap-1");
    expect(calls[1]?.url).toMatch(/\/agents\/33333333-3333-3333-3333-333333333333\/rollback$/);
    expect(calls[1]?.body).toEqual({ snapshot_id: "snap-1" });
  });
});

describe("agent preview ports", () => {
  it("exposes a port with a slug, lists, and revokes", async () => {
    const { neev, calls } = client([
      json(200, { port: 3000, slug: "k3x9q2ab", preview_url: "https://k3x9q2ab.p.example" }),
      json(200, {
        ports: [{ port: 3000, slug: "k3x9q2ab", preview_url: "https://k3x9q2ab.p.example" }],
      }),
      new Response(null, { status: 204 }),
    ]);
    const p = await neev.agents.exposePort("ag-1", 3000, { slug: "k3x9q2ab" });
    expect(p.slug).toBe("k3x9q2ab");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toMatch(/\/agents\/ag-1\/ports$/);
    expect(calls[0]?.body).toEqual({ port: 3000, slug: "k3x9q2ab" });

    const ports = await neev.agents.listPorts("ag-1");
    expect(ports.map((x) => x.port)).toEqual([3000]);
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.url).toMatch(/\/agents\/ag-1\/ports$/);

    await neev.agents.revokePort("ag-1", 3000);
    expect(calls[2]?.method).toBe("DELETE");
    expect(calls[2]?.url).toMatch(/\/agents\/ag-1\/ports\/3000$/);
  });

  it("exposes without a slug when none is chosen", async () => {
    const { neev, calls } = client([
      json(200, { port: 8080, slug: "abcd1234", preview_url: "https://abcd1234.p.example" }),
    ]);
    await neev.agents.exposePort("ag-1", 8080);
    expect(calls[0]?.body).toEqual({ port: 8080 });
  });

  it("getUrl on the handle exposes, then polls the preview URL until routed", async () => {
    const { neev, calls } = client([
      json(200, agentData()),
      json(200, { port: 3000, slug: "zz11yy22", preview_url: "https://zz11yy22.p.example" }),
      new Response(null, { status: 404 }),
      new Response(null, { status: 200 }),
    ]);
    const agent = await neev.agents.get("ag-1");
    const url = await agent.getUrl({ port: 3000, slug: "zz11yy22", pollIntervalMs: 1 });
    expect(url).toBe("https://zz11yy22.p.example");
    expect(calls[1]?.url).toMatch(/\/agents\/33333333-3333-3333-3333-333333333333\/ports$/);
    expect(calls[1]?.body).toEqual({ port: 3000, slug: "zz11yy22" });
    expect(calls[2]?.url).toBe("https://zz11yy22.p.example/");
    expect(calls).toHaveLength(4);
  });

  it("handle exposePort/listPorts/revokePort target the agent's id", async () => {
    const { neev, calls } = client([
      json(200, agentData()),
      json(200, { port: 3000, slug: "abcd1234", preview_url: "https://abcd1234.p.example" }),
      json(200, { ports: [] }),
      new Response(null, { status: 204 }),
    ]);
    const agent = await neev.agents.get("ag-1");
    await agent.exposePort(3000, { slug: "abcd1234" });
    await agent.listPorts();
    await agent.revokePort(3000);
    const id = "33333333-3333-3333-3333-333333333333";
    expect(calls[1]?.url).toMatch(new RegExp(`/agents/${id}/ports$`));
    expect(calls[1]?.body).toEqual({ port: 3000, slug: "abcd1234" });
    expect(calls[2]?.url).toMatch(new RegExp(`/agents/${id}/ports$`));
    expect(calls[3]?.url).toMatch(new RegExp(`/agents/${id}/ports/3000$`));
  });
});

describe("agent audit trail", () => {
  it("reads one page with the window and paging query", async () => {
    const { neev, calls } = client([
      json(200, agentData()),
      json(200, {
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-02T00:00:00Z",
        retention_days: 30,
        window_truncated: true,
        data: [auditEvent()],
      }),
    ]);
    const agent = await neev.agents.get("ag-1");
    const page = await agent.audit({ cursor: "c1", limit: 10 });
    expect(page.window_truncated).toBe(true);
    expect(page.data[0]?.api?.operation).toBe("fs.read");
    const url = new URL(calls[1]?.url ?? "");
    expect(calls[1]?.method).toBe("GET");
    expect(url.pathname).toMatch(/\/agents\/33333333-3333-3333-3333-333333333333\/audit$/);
    expect(url.searchParams.get("cursor")).toBe("c1");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.has("from")).toBe(false);
  });

  it("sends the filters on the agent route", async () => {
    const { neev, calls } = client([
      json(200, { from: "a", to: "b", retention_days: 30, window_truncated: false, data: [] }),
    ]);
    await neev.agents.audit("ag-1", { operation: ["exec", "ssh"], actorType: "user" });
    const url = new URL(calls[0]?.url ?? "");
    expect(url.searchParams.get("operation")).toBe("exec,ssh");
    expect(url.searchParams.get("actor_type")).toBe("user");
  });
});

describe("agent snapshots and fork", () => {
  const FORK_ID = "44444444-4444-4444-4444-444444444444";

  it("creates and lists snapshots on the agent route", async () => {
    const page = { items: [snapshotData({ status: "Ready" })], total: 1, page: 2, limit: 5 };
    const { neev, calls } = client([
      json(202, snapshotData()),
      json(200, page),
      json(202, snapshotData()),
    ]);
    const snap = await neev.agents.createSnapshot("ag-1", { name: "before-change" });
    expect(snap.status).toBe("Pending");
    const listed = await neev.agents.listSnapshots("ag-1", { page: 2, limit: 5 });
    expect(listed).toEqual(page);
    await neev.agents.createSnapshot("ag-1");

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toMatch(/\/agents\/ag-1\/snapshots$/);
    expect(calls[0]?.body).toEqual({ name: "before-change" });
    const url = new URL(calls[1]?.url ?? "");
    expect(calls[1]?.method).toBe("GET");
    expect(url.pathname).toMatch(/\/agents\/ag-1\/snapshots$/);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(calls[2]?.body).toEqual({});
  });

  it("fork returns a handle to the new agent", async () => {
    const { neev, calls } = client([json(201, agentData({ id: FORK_ID, status: "Provisioning" }))]);
    const forked = await neev.agents.fork("ag-1", "web-fork");
    expect(forked).toBeInstanceOf(Agent);
    expect(forked.id).toBe(FORK_ID);
    expect(forked.status).toBe("Provisioning");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toMatch(/\/agents\/ag-1\/fork$/);
    expect(calls[0]?.body).toEqual({ name: "web-fork" });
  });

  it("handle snapshot, snapshots and fork leave the source handle unchanged", async () => {
    const snap = snapshotData();
    const { neev, calls } = client([
      json(200, agentData()),
      json(202, snap),
      json(202, snap),
      json(200, snapshotData({ status: "Ready" })),
      json(200, { items: [snap], total: 1, page: 1, limit: 20 }),
      json(201, agentData({ id: FORK_ID, status: "Provisioning" })),
    ]);
    const agent = await neev.agents.get("ag-1");
    expect((await agent.snapshot({ name: "before-change" })).status).toBe("Pending");
    expect((await agent.snapshot({ waitUntilReady: true, pollIntervalMs: 1 })).status).toBe(
      "Ready",
    );
    expect((await agent.snapshots()).items.map((s) => s.id)).toEqual([snap.id]);
    const forked = await agent.fork("web-fork");
    expect(forked).not.toBe(agent);
    expect(forked.id).toBe(FORK_ID);
    expect(agent.id).toBe(agentData().id);
    expect(agent.status).toBe(agentData().status);

    const seen = calls
      .slice(1)
      .map((c) => `${c.method} ${new URL(c.url).pathname.split("/").slice(-2).join("/")}`);
    expect(seen).toEqual([
      `POST ${agent.id}/snapshots`,
      `POST ${agent.id}/snapshots`,
      `GET snapshots/${snap.id}`,
      `GET ${agent.id}/snapshots`,
      `POST ${agent.id}/fork`,
    ]);
  });

  it("rejects bad wait timings before creating a snapshot", async () => {
    const { neev, calls } = client([json(200, agentData())]);
    const agent = await neev.agents.get("ag-1");
    await expect(agent.snapshot({ waitUntilReady: true, timeoutMs: 0 })).rejects.toThrow(
      /timeoutMs must be a positive/,
    );
    expect(calls).toHaveLength(1);
  });

  it.each([
    [409, ConflictError],
    [425, TooEarlyError],
  ])("fork and createSnapshot surface HTTP %i as %O", async (status, ErrorClass) => {
    const body = { code: "agent_not_ready", message: "not ready" };
    const { neev } = client([json(status, body), json(status, body)]);
    const forkErr = await neev.agents.fork("ag-1", "web-fork").catch((e: unknown) => e);
    expect(forkErr).toBeInstanceOf(ErrorClass);
    expect((forkErr as ConflictError).status).toBe(status);
    expect((forkErr as ConflictError).code).toBe("agent_not_ready");
    await expect(neev.agents.createSnapshot("ag-1")).rejects.toBeInstanceOf(ErrorClass);
  });
});
