import { describe, expect, it } from "vitest";
import { type FetchLike, Neev, NeevError, type SandboxLastCrash } from "../src/index.js";
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
    // Compile-time check: the getter exists and its type is exported from the barrel.
    const lastCrash: SandboxLastCrash | null = sb.lastCrash;
    expect(lastCrash).toBeNull();
  });

  it("reports the last crash, distinguishing a storage reset from a survivor", async () => {
    const neev = client([
      json(201, sandboxData({ last_crash: null })),
      json(
        201,
        sandboxData({
          last_crash: { reason: "OOMKilled", at: "2026-06-05T01:00:00Z", storage_reset: false },
        }),
      ),
      json(
        201,
        sandboxData({
          last_crash: { reason: "NodeLost", at: "2026-06-05T02:00:00Z", storage_reset: true },
        }),
      ),
    ]);
    // An explicit null from the server reads back as null, exactly like an absent field.
    const never = await neev.sandboxes.create({ name: "never" });
    expect(never.lastCrash).toBeNull();

    // A crash whose files survived is distinguishable from never having crashed.
    const survived = await neev.sandboxes.create({ name: "survived" });
    expect(survived.lastCrash).toEqual({
      reason: "OOMKilled",
      at: "2026-06-05T01:00:00Z",
      storage_reset: false,
    });

    // A storage reset means the sandbox came back with an empty filesystem.
    const wiped = await neev.sandboxes.create({ name: "wiped" });
    expect(wiped.lastCrash?.storage_reset).toBe(true);
    expect(JSON.parse(JSON.stringify(wiped)).last_crash.reason).toBe("NodeLost");
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
