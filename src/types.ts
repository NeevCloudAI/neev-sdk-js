import type { components } from "./generated/aiagent.js";

// Clean, public-facing aliases over the generated OpenAPI schema types. Consumers
// import these instead of reaching into the generated `components` tree.

// A sandbox as returned by the API. The Sandbox handle class wraps this shape.
export type SandboxData = components["schemas"]["Sandbox"];

// Key-value labels on a sandbox (at most 16); the server validates key and value format.
export type SandboxLabels = components["schemas"]["SandboxLabels"];

// Lifecycle phase reported by the service.
export type SandboxPhase = components["schemas"]["SandboxPhase"];

// The most recent unexpected stop of a sandbox, or null if it has never had one.
// Historical — not cleared when the sandbox recovers, so read `at` before acting.
// `storage_reset` true means the sandbox restarted empty: files under /workspace,
// and anything installed since create, are gone. Restoring from a snapshot taken
// before that stop brings the files back and clears it once the restore completes.
export type SandboxLastCrash = components["schemas"]["SandboxLastCrash"];

// SDK-only convenience fields on sandbox and agent create that translate into the
// `egress` policy. Pass a full `egress` object for anything these don't cover; an
// explicit `egress` always wins over them.
export interface EgressConvenience {
  // Open all egress (0.0.0.0/0 and ::/0). Default is deny-all; opt in with true.
  allowInternet?: boolean;
  // Allow egress to specific hosts — FQDN or CIDR (wildcards supported).
  allowEgress?: string[];
}

// Request body accepted by `sandboxes.create`. Set at most one of
// `sandbox_template_id` (catalogue) or `image` (BYOI — a public OCI image, with an
// optional `command`); omit both for the platform default. `lifecycle` sets
// idle/lifetime windows at create time.
export type CreateSandboxParams = components["schemas"]["CreateSandboxRequest"] & EgressConvenience;

// What the platform does when a sandbox goes idle or hits its max lifetime.
export type OnIdleAction = components["schemas"]["OnIdleAction"];

// Idle/lifetime windows set at create time (`create({ lifecycle })`). Durations are
// in seconds; send 0 to turn a window off (no limit), or omit a field to use the
// account default.
export type SandboxLifecycle = components["schemas"]["SandboxLifecycle"];

// Windows accepted by `sandboxes.updateTimeout` / `sandbox.updateTimeout`. Durations
// are in seconds; send 0 to turn a window off (no limit), or omit a field to leave
// it unchanged.
export type UpdateTimeoutParams = components["schemas"]["UpdateSandboxTimeoutRequest"];

// Compute size (cpu / memory_gb / disk_gb) for a sandbox. Omitted fields use the
// platform default.
export type SandboxResources = components["schemas"]["SandboxResources"];

// Network egress policy for a sandbox (mode plus optional allow rules).
export type SandboxEgressConfig = components["schemas"]["SandboxEgressConfig"];

// A single egress allow rule (host plus optional ports/protocol).
export type SandboxEgressRule = components["schemas"]["SandboxEgressRule"];

// A set of allow rules on their own, used by `egress_add` / `egress_remove` on
// update to edit the allow-list in place without restating the whole policy.
export type SandboxEgressRules = components["schemas"]["SandboxEgressRules"];

// A single environment variable passed to a sandbox.
export type EnvVar = components["schemas"]["EnvVar"];

// Paginated list payload returned by `sandboxes.list`.
export type SandboxListResponse = components["schemas"]["SandboxListResponse"];

// Metric series bundle returned by `sandboxes.metrics`.
export type SandboxMetricsResponse = components["schemas"]["SandboxMetricsResponse"];

// One named time series within a metrics response.
export type MetricSeries = components["schemas"]["MetricSeries"];

// A port exposed for credential-free preview URLs, with its slug and public URL.
export type SandboxPort = components["schemas"]["SandboxPort"];

// One call recorded in an audit trail, as an OCSF API Activity event: who made it
// (`actor`), what it was (`api.operation`), what it touched and how it ended.
export type AuditEvent = components["schemas"]["AuditEvent"];

// Who made an audited call; `user.type` is "user", "api_key", "system" or "unknown".
export type AuditActor = components["schemas"]["AuditActor"];

// The principal behind an audited call.
export type AuditActorUser = components["schemas"]["AuditActorUser"];

// The audited call itself, such as `exec` or `fs.read`.
export type AuditAPI = components["schemas"]["AuditAPI"];

// Something an audited call touched: the sandbox, a file, a process, a terminal.
export type AuditResource = components["schemas"]["AuditResource"];

// Kind of principal to filter an audit read by.
export type AuditActorType = components["schemas"]["AuditActorTypeFilterValue"];

// Outcome to filter an audit read by.
export type AuditStatusFilter = components["schemas"]["AuditStatusFilter"];

// One page of a sandbox's audit trail, newest first. Pass `next_cursor` as
// `cursor` to read the next page; it is absent when the window is exhausted.
export type AuditTrail = components["schemas"]["AuditTrailResponse"];

// A platform-managed sandbox runtime template, referenced as
// `sandbox_template_id` at create time.
export type SandboxTemplate = components["schemas"]["SandboxTemplate"];

// Catalogue category of a sandbox template ("standard" | "browser").
export type SandboxTemplateCategory = components["schemas"]["SandboxTemplateCategory"];

// Lifecycle status of a sandbox template ("active" | "deprecated" | "disabled").
export type SandboxTemplateStatus = components["schemas"]["SandboxTemplateStatus"];

// Paginated list payload returned by `templates.list`.
export type SandboxTemplateListResponse = components["schemas"]["SandboxTemplateListResponse"];

// A snapshot captured from a sandbox's filesystem. trigger is optional because an API that predates it omits it.
export type SnapshotData = Omit<components["schemas"]["Snapshot"], "trigger"> & {
  trigger?: SnapshotTrigger;
};

// Lifecycle status of a snapshot ("Pending" | "Running" | "Ready" | "Failed").
export type SnapshotStatus = components["schemas"]["SnapshotStatus"];

// Why a snapshot was taken: "manual" or "memory_pressure".
export type SnapshotTrigger = components["schemas"]["SnapshotTrigger"];

// Caller-facing options for `sandbox.snapshot` / `sandboxes.createSnapshot`.
export type CreateSnapshotParams = components["schemas"]["CreateSnapshotRequest"];

// Paginated list payload returned by `sandboxes.listSnapshots`.
export type SnapshotListResponse = Omit<components["schemas"]["SnapshotListResponse"], "items"> & {
  items: SnapshotData[];
};

// An agent as returned by the API. The Agent handle class wraps this shape.
export type AgentData = components["schemas"]["Agent"];

// Lifecycle status of an agent, derived from its backing sandbox
// ("Provisioning" | "Ready" | "Paused" | "Failed" | "Deleting").
export type AgentStatus = components["schemas"]["AgentStatus"];

// The most recent unexpected stop of an agent; same shape as SandboxLastCrash.
export type AgentLastCrash = components["schemas"]["AgentLastCrash"];

// Request body accepted by `agents.create`. Requires `name` and a catalogue
// `agent_template` name; the server provisions the backing sandbox from it.
export type CreateAgentParams = components["schemas"]["CreateAgentRequest"] & EgressConvenience;

// Partial in-place update accepted by `agents.update` (resources, egress and/or
// idle window). `egress_add` / `egress_remove` edit the allow-list in place and
// cannot be combined with `egress`. Carries the same `allowInternet` /
// `allowEgress` convenience as create.
export type UpdateAgentParams = components["schemas"]["UpdateAgentRequest"] & EgressConvenience;

// Partial in-place update accepted by `sandboxes.update` (egress and/or resources).
// At least one of `resources`, `egress`, `egress_add` or `egress_remove` must be
// provided; `egress` replaces the policy in full and cannot be combined with
// `egress_add` / `egress_remove`. `disk_gb` is not resizable in place. Carries the
// same egress convenience as create.
export type UpdateSandboxParams = components["schemas"]["UpdateSandboxRequest"] & EgressConvenience;

// Paginated list payload returned by `agents.list`.
export type AgentListResponse = components["schemas"]["AgentListResponse"];

// A platform-managed agent template, referenced by name at agent create time.
export type AgentTemplate = components["schemas"]["AgentTemplate"];

// Paginated list payload returned by `agentTemplates.list`.
export type AgentTemplateListResponse = components["schemas"]["AgentTemplateListResponse"];
