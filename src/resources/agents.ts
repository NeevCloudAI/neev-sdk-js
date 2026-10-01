import type { Client } from "openapi-fetch";
import { Agent } from "../agent.js";
import type { RequestContext, Scope } from "../client.js";
import { assertUpdateBody, withEgressConvenience } from "../egress.js";
import type { paths } from "../generated/aiagent.js";
import { ensureOk, unwrap } from "../http.js";
import { exposePortBody, waitForPreviewUrl } from "../preview.js";
import type { ExposePortParams, GetPortUrlOptions } from "../preview.js";
import type {
  AgentData,
  AgentListResponse,
  AuditTrail,
  CreateAgentParams,
  SandboxPort,
  UpdateAgentParams,
} from "../types.js";
import type { AuditParams, Sandboxes } from "./sandboxes.js";

// Spec path templates for the aiagent agent endpoints. openapi-fetch type-checks
// each call against these literal paths and the generated `paths` type.
const COLLECTION = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents";
const ITEM = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}";
const PAUSE = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}/pause";
const RESUME = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}/resume";
const KEEPALIVE = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}/keepalive";
const ROLLBACK = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}/rollback";
const PORTS = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}/ports";
const PORT = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}/ports/{port}";
const AUDIT = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/agents/{agent_id}/audit";

// The fields an in-place agent update can carry; at least one must be set.
const AGENT_UPDATE_FIELDS = [
  "resources",
  "egress",
  "egress_add",
  "egress_remove",
  "idle_timeout_seconds",
] as const;

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
  // until it is Ready. `idle_timeout_seconds` sets the idle window (0 = no idle
  // limit; omit for the account default).
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

  // Fetches a single agent by id or by name (names are unique within a project).
  // Every other method that takes an agent id accepts its name too.
  async get(id: string, scope?: Scope): Promise<Agent> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
    });
    return new Agent(this, unwrap<AgentData>(res), scope);
  }

  // Updates an agent in place (cpu/memory, egress and/or idle window) and returns
  // the updated handle. `resources` are resized in place; `egress` replaces the
  // policy in full with no restart; `egress_add` / `egress_remove` edit the
  // allow-list in place (removals apply first) and cannot be combined with
  // `egress`; `idle_timeout_seconds` sets the idle window (0 = no idle limit);
  // disk is not resizable in place. The `allowInternet` / `allowEgress`
  // convenience maps to `egress` exactly as it does on create. Rejects an empty
  // or conflicting patch locally rather than letting the server 400 on it.
  async update(id: string, params: UpdateAgentParams, scope?: Scope): Promise<Agent> {
    const body = withEgressConvenience(params);
    assertUpdateBody(body, "agents.update", AGENT_UPDATE_FIELDS);
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.PATCH(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
      body,
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

  // Resets an agent's idle timer, keeping a busy agent running without an open
  // connection. Call it periodically while work is in progress (e.g. once per
  // agent turn). Returns the updated handle.
  async keepalive(id: string, scope?: Scope): Promise<Agent> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(KEEPALIVE, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
    });
    return new Agent(this, unwrap<AgentData>(res), scope);
  }

  // Rolls an agent's backing sandbox back in place to one of its snapshots,
  // returning the updated handle.
  async rollback(id: string, snapshotId: string, scope?: Scope): Promise<Agent> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(ROLLBACK, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
      body: { snapshot_id: snapshotId },
    });
    return new Agent(this, unwrap<AgentData>(res), scope);
  }

  // Exposes an agent port for credential-free preview URLs and returns it with its
  // slug and URL. Idempotent: exposing an already-exposed port returns the same URL,
  // unless a different `slug` is supplied — that rotates the slug and breaks the old URL.
  async exposePort(id: string, port: number, params: ExposePortParams = {}): Promise<SandboxPort> {
    const { slug, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(PORTS, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
      body: exposePortBody(port, { slug }),
    });
    return unwrap<SandboxPort>(res);
  }

  // Lists the ports currently exposed for this agent's preview URLs.
  async listPorts(id: string, scope?: Scope): Promise<SandboxPort[]> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(PORTS, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id } },
    });
    return unwrap<{ ports: SandboxPort[] }>(res).ports;
  }

  // Revokes a previously exposed agent preview port. Revoking a port that is not
  // exposed succeeds and changes nothing.
  async revokePort(id: string, port: number, scope?: Scope): Promise<void> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.DELETE(PORT, {
      params: { path: { org_id: orgId, project_id: projectId, agent_id: id, port } },
    });
    ensureOk(res);
  }

  // Exposes an agent port and returns its public preview URL, by default polling
  // the URL until it is reachable; pass `{ waitUntilReady: false }` to skip the wait.
  async getPortUrl(
    id: string,
    port: number,
    options: GetPortUrlOptions = {},
    scope?: Scope,
  ): Promise<string> {
    const { preview_url } = await this.exposePort(id, port, { ...scope, slug: options.slug });
    if (options.waitUntilReady === false) return preview_url;
    await waitForPreviewUrl(this.ctx.fetch, preview_url, options);
    return preview_url;
  }

  // Reads one page of the agent's audit trail, newest first. The response's
  // `sandbox_id` is the agent's backing sandbox, not the agent id.
  async audit(id: string, params: AuditParams = {}): Promise<AuditTrail> {
    const { from, to, cursor, limit, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(AUDIT, {
      params: {
        path: { org_id: orgId, project_id: projectId, agent_id: id },
        query: { from, to, cursor, limit },
      },
    });
    return unwrap<AuditTrail>(res);
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
