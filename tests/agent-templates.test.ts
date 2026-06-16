import { describe, expect, it } from "vitest";
import { Neev, NotFoundError } from "../src/index.js";
import { agentTemplateData, json, mockFetch } from "./helpers.js";

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

describe("agentTemplates resource", () => {
  it("lists agent templates with pagination", async () => {
    const { neev, calls } = client([
      json(200, {
        items: [agentTemplateData(), agentTemplateData({ id: "ag-codex", name: "codex" })],
        total: 2,
        page: 1,
        limit: 20,
      }),
    ]);
    const page = await neev.agentTemplates.list({ page: 1, limit: 20 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items[1]?.name).toBe("codex");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/api/v1beta1/agent-templates");
    expect(calls[0]?.url).toContain("page=1");
    expect(calls[0]?.url).toContain("limit=20");
  });

  it("fetches a single agent template by id", async () => {
    const { neev, calls } = client([json(200, agentTemplateData({ id: "ag-claude-code" }))]);
    const tpl = await neev.agentTemplates.get("ag-claude-code");
    expect(tpl.id).toBe("ag-claude-code");
    expect(tpl.status).toBe("active");
    expect(calls[0]?.url).toMatch(/\/agent-templates\/ag-claude-code$/);
  });

  it("throws a typed error when a template is missing", async () => {
    const { neev } = client([json(404, { error: "not_found", details: "no such template" })]);
    const err = await neev.agentTemplates.get("ag-missing").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
  });

  it("agent-templates endpoint is not org/project scoped", async () => {
    const { neev, calls } = client([json(200, { items: [], total: 0, page: 1, limit: 20 })]);
    await neev.agentTemplates.list();
    expect(calls[0]?.url).not.toContain("/orgs/");
    // Param-less list must not serialize undefined page/limit into the query.
    expect(calls[0]?.url).not.toContain("page=");
    expect(calls[0]?.url).not.toContain("limit=");
  });
});
