import type { Client } from "openapi-fetch";
import type { RequestContext, Scope } from "../client.js";
import { assertUpdateBody, withEgressConvenience } from "../egress.js";
import { NeevError } from "../errors.js";
import type { paths } from "../generated/aiagent.js";
import { ensureOk, unwrap } from "../http.js";
import { exposePortBody, waitForPreviewUrl } from "../preview.js";
import type { ExposePortParams, GetPortUrlOptions } from "../preview.js";
import type { SandboxConnection } from "../runtime.js";
import { Sandbox } from "../sandbox.js";
import type {
  AuditTrail,
  CreateSandboxParams,
  CreateSnapshotParams,
  OnIdleAction,
  SandboxData,
  SandboxListResponse,
  SandboxMetricsResponse,
  SandboxPhase,
  SandboxPort,
  SnapshotData,
  SnapshotListResponse,
  UpdateSandboxParams,
  UpdateTimeoutParams,
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
const ROLLBACK = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/rollback";
const FORK = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/fork";
const PORTS = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/ports";
const PORT = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/ports/{port}";
const KEEPALIVE =
  "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/keepalive";
const TIMEOUT = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/timeout";
const AUDIT = "/api/v1beta1/orgs/{org_id}/projects/{project_id}/sandboxes/{sandbox_id}/audit";

// The fields an in-place sandbox update can carry; at least one must be set.
const SANDBOX_UPDATE_FIELDS = ["resources", "egress", "egress_add", "egress_remove"] as const;

// The on_idle values the API accepts. Kept in sync with the generated OnIdleAction
// enum; used to reject a bad value locally before a request goes out.
const ON_IDLE_ACTIONS: readonly OnIdleAction[] = ["pause", "delete"];

// Rejects an out-of-enum on_idle before the request is sent. Undefined is allowed
// (the field is optional); any other non-enum value throws.
function assertOnIdle(value: OnIdleAction | undefined): void {
  if (value !== undefined && !ON_IDLE_ACTIONS.includes(value)) {
    throw new NeevError(
      `Invalid on_idle "${value}"; expected one of ${ON_IDLE_ACTIONS.map((a) => `"${a}"`).join(", ")}.`,
    );
  }
}

export type { ExposePortOptions, ExposePortParams, GetPortUrlOptions } from "../preview.js";

// Parameters for listing sandboxes: pagination and optional filters, plus an
// optional scope override. Filters combine with AND; omit one to leave it off.
export interface ListSandboxesParams extends Scope {
  page?: number;
  limit?: number;
  // Case-insensitive substring match on the sandbox name.
  name?: string;
  // Exact lifecycle-phase match.
  status?: SandboxPhase;
  // Narrow to a single sandbox by its id.
  sandboxId?: string;
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
// Sandbox handle. All optional — the platform defaults to the last hour.
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

// The window and paging fields of an audit-trail read; shared by the resource
// method and the Sandbox handle. All optional.
export interface AuditQuery {
  // Start of the window (RFC3339). Defaults to 24 hours before `to`.
  from?: string;
  // End of the window (RFC3339). Defaults to now.
  to?: string;
  // The previous page's `next_cursor`, to read the next (older) page.
  cursor?: string;
  // Records per page (1-200, default 50).
  limit?: number;
}

// Audit-trail query plus an optional scope override.
export interface AuditParams extends Scope, AuditQuery {}

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

  // Opens a connection to the sandbox runtime at the given connect_url. Used by the
  // Sandbox handle to back `sandbox.files` / `sandbox.exec`.
  connect(connectUrl: string): SandboxConnection {
    return this.ctx.createSandboxConnection(connectUrl);
  }

  // Creates a sandbox in the resolved org/project. The returned handle may still
  // be in the Pending phase — call `waitUntilReady` to block until it is Ready.
  // `lifecycle` (idle/lifetime windows) and BYOI `image`/`command` pass through the
  // request body untouched; omitting `lifecycle` sends no lifecycle key, so account
  // defaults apply.
  async create(params: CreateSandboxParams, scope?: Scope): Promise<Sandbox> {
    assertOnIdle(params.lifecycle?.on_idle);
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(COLLECTION, {
      params: { path: { org_id: orgId, project_id: projectId } },
      body: withEgressConvenience(params),
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Lists sandboxes in the resolved org/project, returning wrapped handles.
  async list(params: ListSandboxesParams = {}): Promise<SandboxPage> {
    const { page, limit, name, status, sandboxId, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(COLLECTION, {
      params: {
        path: { org_id: orgId, project_id: projectId },
        query: { page, limit, name, status, sandbox_id: sandboxId },
      },
    });
    const data = unwrap<SandboxListResponse>(res);
    return {
      items: data.items.map((item) => new Sandbox(this, item, scope)),
      total: data.total,
      page: data.page,
      limit: data.limit,
    };
  }

  // Fetches a single sandbox by id or by name (names are unique within a project).
  // Every other method that takes a sandbox id accepts its name too.
  async get(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Resets a sandbox's idle timer, keeping a busy sandbox alive without an open
  // connection. Call it periodically while work is in progress (e.g. once per agent
  // turn). Returns the updated handle.
  async keepalive(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(KEEPALIVE, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Changes a running sandbox's idle/lifetime windows and returns the updated
  // handle. Durations are in seconds; only the fields passed change (send 0 to turn
  // a window off, omit a field to leave it unchanged). Rejects an out-of-enum
  // `on_idle` locally before the request is sent.
  async updateTimeout(id: string, windows: UpdateTimeoutParams, scope?: Scope): Promise<Sandbox> {
    assertOnIdle(windows.on_idle);
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.PUT(TIMEOUT, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
      body: windows,
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Updates a running sandbox in place (cpu/memory and/or egress) and returns the
  // updated handle — same id, name, and preview URLs. `resources` are resized in
  // place; `egress` replaces the policy in full and takes effect for new
  // connections with no restart. `egress_add` / `egress_remove` edit the existing
  // allow-list in place (removals apply first, so one call can swap a host) and
  // cannot be combined with `egress`. `disk_gb` is not resizable in place and is
  // rejected by the server if changed. The `allowInternet` / `allowEgress`
  // convenience maps to `egress` exactly as it does on create. Rejects an empty
  // or conflicting patch locally rather than letting the server 400 on it.
  async update(id: string, params: UpdateSandboxParams, scope?: Scope): Promise<Sandbox> {
    const body = withEgressConvenience(params);
    assertUpdateBody(body, "sandboxes.update", SANDBOX_UPDATE_FIELDS);
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.PATCH(ITEM, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
      body,
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Pauses a sandbox (it stops running and keeps its state) and returns the updated handle.
  async pause(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(PAUSE, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Resumes a paused sandbox from its kept state and returns the updated handle.
  async resume(id: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(RESUME, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Permanently deletes a sandbox.
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

  // Reads one page of the sandbox's audit trail, newest first: what ran inside it
  // (program names only, never arguments) and the file and process operations made.
  async audit(id: string, params: AuditParams = {}): Promise<AuditTrail> {
    const { from, to, cursor, limit, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(AUDIT, {
      params: {
        path: { org_id: orgId, project_id: projectId, sandbox_id: id },
        query: { from, to, cursor, limit },
      },
    });
    return unwrap<AuditTrail>(res);
  }

  // Exposes a port for credential-free preview URLs and returns it with its slug and
  // URL. Idempotent: exposing an already-exposed port returns the same URL, unless a
  // different `slug` is supplied — that rotates the slug and breaks the old URL.
  async exposePort(id: string, port: number, params: ExposePortParams = {}): Promise<SandboxPort> {
    const { slug, ...scope } = params;
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(PORTS, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
      body: exposePortBody(port, { slug }),
    });
    return unwrap<SandboxPort>(res);
  }

  // Lists the ports currently exposed for this sandbox's preview URLs.
  async listPorts(id: string, scope?: Scope): Promise<SandboxPort[]> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.GET(PORTS, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
    });
    return unwrap<{ ports: SandboxPort[] }>(res).ports;
  }

  // Revokes a previously exposed preview port. Revoking a port that is not
  // exposed succeeds and changes nothing.
  async revokePort(id: string, port: number, scope?: Scope): Promise<void> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.DELETE(PORT, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id, port } },
    });
    ensureOk(res);
  }

  // Exposes a port and returns its public preview URL. The URL is not reachable
  // the instant a port is exposed, so by default this polls the URL until it
  // is reachable before returning; pass `{ waitUntilReady: false }` to skip the
  // wait and return immediately.
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
      body: { ...params },
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

  // Rolls a sandbox back in place to one of its snapshots, returning the updated
  // handle. The snapshot must belong to a sandbox in the same project.
  async rollback(id: string, snapshotId: string, scope?: Scope): Promise<Sandbox> {
    const { orgId, projectId } = this.ctx.resolveScope(scope);
    const res = await this.api.POST(ROLLBACK, {
      params: { path: { org_id: orgId, project_id: projectId, sandbox_id: id } },
      body: { snapshot_id: snapshotId },
    });
    return new Sandbox(this, unwrap<SandboxData>(res), scope);
  }

  // Forks a sandbox into a new named sandbox. The server atomically snapshots the
  // source's *current* live state and seeds the new sandbox from it; the source
  // keeps running. This always forks the current state — it does not reuse a
  // previously created snapshot (use rollback for a chosen snapshot). Returns a
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
