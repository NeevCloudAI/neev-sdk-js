import { describe, expect, it } from "vitest";
import { type FetchLike, Neev, NeevError } from "../src/index.js";
import { json, mockFetch, sandboxData } from "./helpers.js";

// Builds a client backed by the given queued responses.
function client(queue: Array<Response | Error>) {
  const mock = mockFetch(queue);
  return new Neev({
    apiKey: "k",
    orgId: "org_test",
    projectId: "proj_test",
    maxRetries: 0,
    fetch: mock.fetch,
  });
}

// Builds a client whose every response reports the given phase, so polling never
// exhausts a finite queue.
function alwaysPhaseClient(phase: string) {
  const fetch: FetchLike = async () => json(200, sandboxData({ phase: phase as never }));
  return new Neev({
    apiKey: "k",
    orgId: "org_test",
    projectId: "proj_test",
    maxRetries: 0,
    fetch,
  });
}

describe("Sandbox handle", () => {
  it("exposes core fields and the raw record", async () => {
    const neev = client([json(201, sandboxData({ connect_url: "https://sb.sandboxes.example" }))]);
    const sb = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    expect(sb.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(sb.connectUrl).toBe("https://sb.sandboxes.example");
    expect(sb.data.region).toBe("as-south-1");
    expect(JSON.parse(JSON.stringify(sb)).org_id).toBe("org_test");
  });

  it("updates its state in place after pause", async () => {
    const neev = client([
      json(201, sandboxData({ phase: "Ready", replicas: 1 })),
      json(200, sandboxData({ phase: "Paused", replicas: 0 })),
    ]);
    const sb = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    expect(sb.phase).toBe("Ready");
    await sb.pause();
    expect(sb.phase).toBe("Paused");
    expect(sb.replicas).toBe(0);
  });

  it("update refreshes the handle's state from the resize response", async () => {
    const neev = client([
      json(201, sandboxData({ resources: { cpu: 1, memory_gb: 2 } })),
      json(200, sandboxData({ resources: { cpu: 4, memory_gb: 8 } })),
    ]);
    const sb = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    const same = await sb.update({ resources: { cpu: 4, memory_gb: 8 } });
    expect(same).toBe(sb);
    expect(sb.resources).toEqual({ cpu: 4, memory_gb: 8 });
  });

  it("waitUntilReady resolves once the phase becomes Ready", async () => {
    const neev = client([
      json(201, sandboxData({ phase: "Pending" })),
      json(200, sandboxData({ phase: "Ready" })),
    ]);
    const sb = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    const ready = await sb.waitUntilReady({ pollIntervalMs: 1, timeoutMs: 1000 });
    expect(ready.phase).toBe("Ready");
  });

  it("waitUntilReady throws when the timeout elapses", async () => {
    const neev = alwaysPhaseClient("Pending");
    const sb = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    await expect(sb.waitUntilReady({ pollIntervalMs: 1, timeoutMs: 10 })).rejects.toThrow(
      NeevError,
    );
  });

  it("waitUntilReady fails fast when the sandbox is Paused", async () => {
    const neev = client([json(201, sandboxData({ phase: "Paused", replicas: 0 }))]);
    const sb = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    await expect(sb.waitUntilReady()).rejects.toThrow(/Paused/);
  });

  it("waitUntilReady rejects non-finite or non-positive timings instead of hot-looping", async () => {
    const neev = alwaysPhaseClient("Pending");
    const sb = await neev.sandboxes.create({
      name: "demo",
      sandbox_template_id: "sb-ubuntu-26-04-minimal",
    });
    await expect(sb.waitUntilReady({ timeoutMs: Number.NaN })).rejects.toThrow(/timeoutMs/);
    await expect(sb.waitUntilReady({ pollIntervalMs: 0 })).rejects.toThrow(/pollIntervalMs/);
  });
});
