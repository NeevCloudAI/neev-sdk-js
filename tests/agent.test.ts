import { describe, expect, it } from "vitest";
import { Agent, type FetchLike, Neev, Sandbox } from "../src/index.js";
import { agentData, json, mockFetch, sandboxData } from "./helpers.js";

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

// Builds a client whose every response reports an agent with the given status, so
// polling never exhausts a finite queue.
function alwaysStatusClient(status: string) {
  const fetch: FetchLike = async () => json(200, agentData({ status: status as never }));
  return new Neev({
    apiKey: "k",
    orgId: "org_test",
    projectId: "proj_test",
    maxRetries: 0,
    fetch,
  });
}

describe("Agent handle", () => {
  it("exposes core fields and the raw record", async () => {
    const { neev } = client([json(201, agentData({ config: { model: "opus" } }))]);
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });
    expect(agent.id).toBe("33333333-3333-3333-3333-333333333333");
    expect(agent.templateId).toBe("ag-claude-code");
    expect(agent.sandboxId).toBe("11111111-1111-1111-1111-111111111111");
    expect(agent.config).toEqual({ model: "opus" });
    expect(JSON.parse(JSON.stringify(agent)).org_id).toBe("org_test");
  });

  it("updates its state in place after pause", async () => {
    const { neev } = client([
      json(201, agentData({ status: "Ready" })),
      json(200, agentData({ status: "Paused" })),
    ]);
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });
    expect(agent.status).toBe("Ready");
    await agent.pause();
    expect(agent.status).toBe("Paused");
  });

  it("refresh, update, resume and delete drive the right calls and update state", async () => {
    const { neev, calls } = client([
      json(201, agentData({ status: "Paused" })),
      json(200, agentData({ status: "Paused" })), // refresh
      json(200, agentData({ status: "Paused", config: { model: "opus" } })), // update
      json(200, agentData({ status: "Ready" })), // resume
      json(204, undefined), // delete
    ]);
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });

    await agent.refresh();
    expect(calls[1]?.method).toBe("GET");

    await agent.update({ egress: { mode: "allow_list" } });
    expect(agent.config).toEqual({ model: "opus" });
    expect(calls[2]?.method).toBe("PATCH");

    await agent.resume();
    expect(agent.status).toBe("Ready");
    expect(calls[3]?.url).toMatch(/\/agents\/[^/]+\/resume$/);

    await agent.delete();
    expect(calls[4]?.method).toBe("DELETE");
  });

  it("resolves its backing sandbox via the sandbox() bridge", async () => {
    const { neev, calls } = client([
      json(201, agentData()),
      json(200, sandboxData({ id: "11111111-1111-1111-1111-111111111111" })),
    ]);
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });
    const sandbox = await agent.sandbox();
    expect(sandbox).toBeInstanceOf(Sandbox);
    expect(sandbox.id).toBe(agent.sandboxId);
    expect(calls[1]?.url).toMatch(/\/sandboxes\/11111111-1111-1111-1111-111111111111$/);
  });

  it("waitUntilReady resolves once the status becomes Ready", async () => {
    const { neev } = client([
      json(201, agentData({ status: "Provisioning" })),
      json(200, agentData({ status: "Ready" })),
    ]);
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });
    const ready = await agent.waitUntilReady({ pollIntervalMs: 1, timeoutMs: 1000 });
    expect(ready.status).toBe("Ready");
  });

  it("waitUntilReady throws when the timeout elapses", async () => {
    const neev = alwaysStatusClient("Provisioning");
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });
    await expect(agent.waitUntilReady({ pollIntervalMs: 1, timeoutMs: 10 })).rejects.toThrow(
      /did not become Ready/,
    );
  });

  it("waitUntilReady fails fast when the agent is Paused", async () => {
    const neev = alwaysStatusClient("Paused");
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });
    await expect(agent.waitUntilReady()).rejects.toThrow(/Paused/);
  });

  it("waitUntilReady fails fast when the agent has Failed", async () => {
    const neev = alwaysStatusClient("Failed");
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });
    await expect(agent.waitUntilReady()).rejects.toThrow(/failed to provision/);
  });

  it("waitUntilReady rejects non-finite or non-positive timings instead of hot-looping", async () => {
    const neev = alwaysStatusClient("Provisioning");
    const agent = await neev.agents.create({ name: "demo", agent_template: "claude-code" });
    await expect(agent.waitUntilReady({ timeoutMs: 0 })).rejects.toThrow(/timeoutMs/);
    await expect(agent.waitUntilReady({ timeoutMs: Number.NaN })).rejects.toThrow(/timeoutMs/);
    await expect(agent.waitUntilReady({ pollIntervalMs: 0 })).rejects.toThrow(/pollIntervalMs/);
    await expect(agent.waitUntilReady({ pollIntervalMs: -1 })).rejects.toThrow(/pollIntervalMs/);
  });
});
