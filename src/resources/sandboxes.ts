import type { Client } from "openapi-fetch";
import type { RequestContext, Scope } from "../client.js";
import { NeevError } from "../errors.js";
import type { paths } from "../generated/aiagent.js";
import { ensureOk, unwrap } from "../http.js";
import { Sandbox } from "../sandbox.js";
import type { SandboxConnection } from "../sandboxd.js";
import type {
  CreateSandboxParams,
  CreateSnapshotParams,
  SandboxData,
  SandboxListResponse,
  SandboxMetricsResponse,
  SnapshotData,
  SnapshotListResponse,
} from "../types.js";

// Spec path templates for the aiagent sandbox endpoints. openapi-fetch type-checks
// each call against these literal paths and the generated `paths` type.
const COLLECTION = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes";
const ITEM = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}";
const PAUSE = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/pause";
const RESUME = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/resume";
const METRICS = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/metrics";
const SNAPSHOTS =
  "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/snapshots";
const SNAPSHOT_ITEM = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/snapshots/{snapshot_id}";
const RESTORE = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/restore";
const FORK = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/fork";

// Parameters for listing sandboxes: pagination plus an optional scope override.
export interface ListSandboxesParams extends Scope {
  page?: number;
  limit?: number;
}

// A page of sandboxes, with the handles already wrapped and the paging metadata.
export interface SandboxPage {
  items: Sandbox[];
  total: number;
  page: number;
  limit: number;
}

// Parameters for listing snapshots: pagination plus an optional scope override.
export interface ListSnapshotsParams extends Scope {
  page?: number;
  limit?: number;
}

// A page of snapshots, preserving the paging metadata so callers can page
// through all of a sandbox's snapshots.
export interface SnapshotPage {
  items: SnapshotData[];
  total: number;
  page: number;
  limit: number;
}

// Default overall wait budget for waitForSnapshot, in milliseconds. Snapshot
// capture copies the filesystem, so it gets a longer default than a sandbox
// readiness wait.
const DEFAULT_SNAPSHOT_WAIT_TIMEOUT_MS = 300_000;
// Default delay between snapshot status polls, in milliseconds.
const DEFAULT_SNAPSHOT_POLL_INTERVAL_MS = 2_000;

// Parameters for waitForSnapshot: poll timing plus an optional scope override.
export interface WaitForSnapshotParams extends Scope {
  // Maximum time to wait for the Ready status, in milliseconds. Defaults to 300000.
  timeoutMs?: number;
  // Delay between status polls, in milliseconds. Defaults to 2000.
  pollIntervalMs?: number;
}

// The time-window fields of a metrics read; shared by the resource method and the
// Sandbox handle. All optional — the server defaults to the last hour.
export interface MetricsQuery {
  // Start of the window (RFC3339). Defaults to one hour before `to`.
  from?: string;
  // End of the window (RFC3339). Defaults to now.
  to?: string;
  // Resolution as a Go duration (e.g. "60s", "5m"). Server clamps to a sane range.
  step?: string;
}

// Query window for a metrics read, plus an optional scope override.
export interface MetricsParams extends Scope, MetricsQuery {}

// Sandbox lifecycle operations. Exposed as `client.sandboxes`. Every method
// returns a Sandbox handle (or page of handles) so callers can chain lifecycle
// actions on the result.
export class Sandboxes {
  private readonly ctx: RequestContext;
  private readonly api: Client<paths>;

  constructor(ctx: RequestContext) {
    this.ctx = ctx;
    this.api = ctx.createTypedClient<paths>();
  }

  // Opens a connection to a sandbox daemon at the given connect_url. Used by the
  // Sandbox handle to back `sandbox.files` / `sandbox.exec`.
  connect(connectUrl: string): SandboxConnection {
    return this.ctx.createSandboxConnection(connectUrl);
  }

  // Creates a sandbox in the resolved org/project. The returned handle may still
  // be in the Pending phase — call `waitUntilReady` to block until it is Ready.
  async create(params: CreateSandboxParams, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(COLLECTION, {
      params: { path: { org_id: orgId, project_id: projectId } },
      body: params,
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Lists sandboxes in the resolved org/project, returning wrapped handles.
  async list(params: ListSandboxesParams = {}): Promise<SandboxPage> {
    const { page, limit, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(COLLECTION, {
      params: { path: { org_id: orgId, project_id: projectId }, query: { page, limit } },
    });
    const data = unwrap<SandboxListResponse>(res);
    return {
      items: data.items.map((item) => new Sandbox(this, item, scope)),
      total: data.total,
      page: data.page,
      limit: data.limit,
    };
  }

  // Fetches a single sandbox by id.
  async get(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Pauses a sandbox (scales it to zero replicas) and returns the updated handle.
  async pause(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(PAUSE, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Resumes a paused sandbox (scales it to one replica) and returns the updated handle.
  async resume(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(RESUME, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Permanently deletes a sandbox, removing the Kubernetes CR and the DB row.
  async delete(id: string, scope?: Scope): Promise<void> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.DELETE(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    ensureOk(res);
  }

  // Reads the live, tenant-scoped metric series for a sandbox.
  async metrics(id: string, params: MetricsParams = {}): Promise<SandboxMetricsResponse> {
    const { from, to, step, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(METRICS, {
      params: {
        path: { org_id: orgId, project_id: projectId, sandbox_id: id },
        query: { from, to, step },
      },
    });
    return unwrap<SandboxMetricsResponse>(res);
  }

  // Captures a snapshot of a sandbox. The returned snapshot starts Pending; poll
  // getSnapshot until its status is Ready before restoring or forking from it.
  async createSnapshot(
    id: string,
    params: CreateSnapshotParams = {},
    scope?: Scope,
  ): Promise<SnapshotData> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(SNAPSHOTS, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
      body: { ...params, include_memory: false },
    });
    return unwrap<SnapshotData>(res);
  }

  // Lists the snapshots taken from a sandbox. The endpoint is paginated, so the
  // returned page carries `total`/`page`/`limit` and accepts `page`/`limit` —
  // callers can page through every snapshot instead of silently getting only the
  // first page.
  async listSnapshots(id: string, params: ListSnapshotsParams = {}): Promise<SnapshotPage> {
    const { page, limit, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(SNAPSHOTS, {
      params: {
        path: { org_id: orgId, project_id: projectId, sandbox_id: id },
        query: { page, limit },
      },
    });
    const data = unwrap<SnapshotListResponse>(res);
    return { items: data.items, total: data.total, page: data.page, limit: data.limit };
  }

  // Fetches a snapshot's metadata by id (project-scoped, not tied to its source sandbox).
  async getSnapshot(snapshotId: string, scope?: Scope): Promise<SnapshotData> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(SNAPSHOT_ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, snapshot_id: snapshotId } },
    });
    return unwrap<SnapshotData>(res);
  }

  // Polls a snapshot until it finishes capturing, returning the Ready snapshot.
  // Throws if the snapshot enters the Failed state (surfacing error_message) or if
  // the timeout elapses first. Use it after createSnapshot before restoring or
  // forking, both of which require the snapshot to be Ready.
  async waitForSnapshot(
    snapshotId: string,
    params: WaitForSnapshotParams = {},
  ): Promise<SnapshotData> {
    const {
      timeoutMs = DEFAULT_SNAPSHOT_WAIT_TIMEOUT_MS,
      pollIntervalMs = DEFAULT_SNAPSHOT_POLL_INTERVAL_MS,
      ...scope
    } = params;
    // Reject non-finite or non-positive timings, which would otherwise spin a
    // near-zero-delay poll loop (or, for NaN, one that never times out).
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new NeevError(
        `waitForSnapshot: timeoutMs must be a positive, finite number (got ${timeoutMs}).`,
      );
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new NeevError(
        `waitForSnapshot: pollIntervalMs must be a positive, finite number (got ${pollIntervalMs}).`,
      );
    }
    const deadline = Date.now() + timeoutMs;

    // Fetch the live status each iteration until Ready, a terminal Failed, or the
    // deadline. getSnapshot is project-scoped, so the source sandbox is not needed.
    while (true) {
      const snapshot = await this.getSnapshot(snapshotId, scope);
      if (snapshot.status === "Ready") return snapshot;
      if (snapshot.status === "Failed") {
        const reason = snapshot.error_message ? `: ${snapshot.error_message}` : "";
        throw new NeevError(`Snapshot ${snapshotId} failed to capture${reason}.`);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new NeevError(
          `Snapshot ${snapshotId} was not Ready within ${timeoutMs}ms (status: ${snapshot.status}).`,
        );
      }
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  // Deletes a snapshot and its stored blob.
  async deleteSnapshot(snapshotId: string, scope?: Scope): Promise<void> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.DELETE(SNAPSHOT_ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, snapshot_id: snapshotId } },
    });
    ensureOk(res);
  }

  // Restores a sandbox in place from one of its snapshots, returning the updated
  // handle. The snapshot must belong to a sandbox in the same project.
  async restore(id: string, snapshotId: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(RESTORE, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
      body: { snapshot_id: snapshotId },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Forks a sandbox into a new named sandbox. The server atomically snapshots the
  // source's *current* live state and seeds the new sandbox from it; the source
  // keeps running. This always forks the current state — it does not reuse a
  // previously created snapshot (use restore for a chosen snapshot). Returns a
  // handle to the new sandbox.
  async fork(id: string, name: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(FORK, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
      body: { name },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }
}

// Resolves after the given number of milliseconds.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
