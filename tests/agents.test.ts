import { describe, expect, it } from "vitest";
import { Agent, Neev, NeevError, NotFoundError } from "../src/index.js";
import { agentData, json, mockFetch } from "./helpers.js";

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
    const { neev, calls } = client([
      json(200, agentData({ status: "Ready", resources: { cpu: 2, memory_gb: 4 } })),
    ]);
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
