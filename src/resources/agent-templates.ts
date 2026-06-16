import type { Client } from "openapi-fetch";
import type { RequestContext } from "../client.js";
import type { paths } from "../generated/aiagent.js";
import { unwrap } from "../http.js";
import type { AgentTemplate, AgentTemplateListResponse } from "../types.js";

// Spec path templates for the agent-template endpoints. openapi-fetch type-checks
// each call against these literal paths and the generated `paths` type. Agent
// templates are platform-managed and not scoped to an org/project.
const COLLECTION = "/api/v1beta1/agent-templates";
const ITEM = "/api/v1beta1/agent-templates/{template_id}";

// Pagination parameters for listing agent templates.
export interface ListAgentTemplatesParams {
  page?: number;
  limit?: number;
}

// A page of agent templates plus the paging metadata.
export interface AgentTemplatePage {
  items: AgentTemplate[];
  total: number;
  page: number;
  limit: number;
}

// Read-only access to the platform's agent-template catalogue. Exposed as
// `client.agentTemplates`. The template `name` (e.g. "claude-code") is passed as
// `agent_template` to `agents.create`, so callers use this resource to discover
// valid templates and their default config/resources/egress.
export class AgentTemplates {
  private readonly api: Client<paths>;

  constructor(ctx: RequestContext) {
    this.api = ctx.createTypedClient<paths>();
  }

  // Lists the available agent templates. Only active templates are returned.
  async list(params: ListAgentTemplatesParams = {}): Promise<AgentTemplatePage> {
    const { page, limit } = params;
    const res = await this.api.GET(COLLECTION, { params: { query: { page, limit } } });
    const data = unwrap<AgentTemplateListResponse>(res);
    return { items: data.items, total: data.total, page: data.page, limit: data.limit };
  }

  // Fetches a single agent template by id (e.g. "ag-claude-code").
  async get(id: string): Promise<AgentTemplate> {
    const res = await this.api.GET(ITEM, { params: { path: { template_id: id } } });
    return unwrap<AgentTemplate>(res);
  }
}
