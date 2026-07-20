import type { Client } from "openapi-fetch";
import { Agent } from "../agent.js";
import type { RequestContext, Scope } from "../client.js";
import { withEgressConvenience } from "../egress.js";
import { NeevError } from "../errors.js";
import type { paths } from "../generated/aiagent.js";
import { ensureOk, unwrap } from "../http.js";
import type {
  AgentData,
  AgentListResponse,
  CreateAgentParams,
  UpdateAgentParams,
} from "../types.js";
import type { Sandboxes } from "./sandboxes.js";

// Spec path templates for the aiagent agent endpoints. openapi-fetch type-checks
// each call against these literal paths and the generated `paths` type.
const COLLECTION = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents";
const ITEM = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}";
const PAUSE = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}/pause";
const RESUME = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}/resume";

// Parameters for listing agents: pagination plus an optional scope override.
export interface ListAgentsParams extends Scope {
  page?: number;
  limit?: number;
}

// A page of agents, with the handles already wrapped and the paging metadata.
export interface AgentPage {
  items: Agent[];
  total: number;
  page: number;
  limit: number;
}

// Agent lifecycle operations. Exposed as `client.agents`. Every method returns an
// Agent handle (or page of handles) so callers can chain lifecycle actions on the
// result. An agent runs on a 1:1 backing sandbox; the handle's `sandbox()` bridge
// reaches that sandbox's files/exec/processes via the `sandboxes` resource.
export class Agents {
  private readonly ctx: RequestContext;
  private readonly api: Client<paths>;
  private readonly sandboxes: Sandboxes;

  constructor(ctx: RequestContext, sandboxes: Sandboxes) {
    this.ctx = ctx;
    this.api = ctx.createTypedClient<paths>();
    this.sandboxes = sandboxes;
  }

  // Resolves the backing sandbox of an agent as a Sandbox handle, so callers can
  // reach its files/exec/processes. Used by the Agent handle's `sandbox()` bridge.
  getSandbox(sandboxId: string, scope?: Scope) {
    return this.sandboxes.get(sandboxId, scope);
  }

  // Creates an agent from a catalogue template in the resolved org/project. The
  // returned handle may still be Provisioning — call `waitUntilReady` to block
  // until it is Ready.
  async create(params: CreateAgentParams, scope?: Scope): Promise<Agent> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(COLLECTION, {
      params: { path: { org_id: orgId, project_id: projectId } },
      body: withEgressConvenience(params),
    });
    return new Agent(this, unwrap<AgentData>(res), scope);
  }

  // Lists agents in the resolved org/project, returning wrapped handles.
  async list(params: ListAgentsParams = {}): Promise<AgentPage> {
    const { page, limit, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(COLLECTION, {
      params: { path: { org_id: orgId, project_id: projectId }, query: { page, limit } },
    });
    const data = unwrap<AgentListResponse>(res);
    return {
      items: data.items.map((item) => new Agent(this, item, scope)),
      total: data.total,
      page: data.page,
      limit: data.limit,
    };
  }

  // Fetches a single agent by id.
  async get(id: string, scope?: Scope): Promise<Agent> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
    });
    return new Agent(this, unwrap<AgentData>(res), scope);
  }

  // Updates an agent in place (egress and/or cpu/memory) and returns the updated
  // handle. Omitted fields are left unchanged; disk is not resizable in place.
  // Rejects an empty patch locally rather than letting the server 400 on it.
  async update(id: string, params: UpdateAgentParams, scope?: Scope): Promise<Agent> {
    if (!Object.values(params).some((value) => value !== undefined)) {
      throw new NeevError("agents.update requires at least one field (egress or resources).");
    }
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.PATCH(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
      body: params,
    });
    return new Agent(this, unwrap<AgentData>(res), scope);
  }

  // Pauses an agent (suspends its backing sandbox) and returns the updated handle.
  async pause(id: string, scope?: Scope): Promise<Agent> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(PAUSE, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
    });
    return new Agent(this, unwrap<AgentData>(res), scope);
  }

  // Resumes a paused agent and returns the updated handle.
  async resume(id: string, scope?: Scope): Promise<Agent> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(RESUME, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
    });
    return new Agent(this, unwrap<AgentData>(res), scope);
  }

  // Permanently deletes an agent and its backing sandbox.
  async delete(id: string, scope?: Scope): Promise<void> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.DELETE(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
    });
    ensureOk(res);
  }
}
