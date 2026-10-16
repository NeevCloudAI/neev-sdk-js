import type { Client } from "openapi-fetch";
import type { RequestContext } from "../client.js";
import type { paths } from "../generated/aiagent.js";
import { unwrap } from "../http.js";
import type { SandboxTemplate, SandboxTemplateListResponse } from "../types.js";

// Spec path templates for the sandbox-template endpoints. openapi-fetch
// type-checks each call against these literal paths and the generated `paths`
// type. Templates are platform-managed and not scoped to an org/project.
const COLLECTION = "/api/v1beta1/sandbox-templates";
const ITEM = "/api/v1beta1/sandbox-templates/{template_id}";

// Pagination parameters for listing sandbox templates.
export interface ListTemplatesParams {
  page?: number;
  limit?: number;
}

// A page of sandbox templates plus the paging metadata.
export interface SandboxTemplatePage {
  items: SandboxTemplate[];
  total: number;
  page: number;
  limit: number;
}

// Read-only access to the platform's sandbox-template catalogue. Exposed as
// `client.templates`. Pass a template id (e.g. "sb-ubuntu-26-04-dev") to
// `sandboxes.create`; this resource lists the valid ones.
export class SandboxTemplates {
  private readonly api: Client<paths>;

  constructor(ctx: RequestContext) {
    this.api = ctx.createTypedClient<paths>();
  }

  // Lists the available sandbox templates. Only active and deprecated templates
  // are returned by the server.
  async list(params: ListTemplatesParams = {}): Promise<SandboxTemplatePage> {
    const { page, limit } = params;
    const res = await this.api.GET(COLLECTION, { params: { query: { page, limit } } });
    const data = unwrap<SandboxTemplateListResponse>(res);
    return { items: data.items, total: data.total, page: data.page, limit: data.limit };
  }

  // Fetches a single sandbox template by id.
  async get(id: string): Promise<SandboxTemplate> {
    const res = await this.api.GET(ITEM, { params: { path: { template_id: id } } });
    return unwrap<SandboxTemplate>(res);
  }
}
