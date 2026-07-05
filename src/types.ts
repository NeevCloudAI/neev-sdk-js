import type { components } from "./generated/aiagent.js";

// Clean, public-facing aliases over the generated OpenAPI schema types. Consumers
// import these instead of reaching into the generated `components` tree.

// A sandbox as returned by the API. The Sandbox handle class wraps this shape.
export type SandboxData = components["schemas"]["Sandbox"];

// Lifecycle phase reported by the service.
export type SandboxPhase = components["schemas"]["SandboxPhase"];

// Request body accepted by `sandboxes.create`. Requires `sandbox_template_id`;
// the server resolves the image and default command from the chosen template.
export type CreateSandboxParams = components["schemas"]["CreateSandboxRequest"];

// Compute size (cpu / memory_gb / disk_gb) for a sandbox. Omitted fields use the
// platform default.
export type SandboxResources = components["schemas"]["SandboxResources"];

// Network egress policy for a sandbox (mode plus optional allow rules).
export type SandboxEgressConfig = components["schemas"]["SandboxEgressConfig"];

// A single egress allow rule (host plus optional ports/protocol).
export type SandboxEgressRule = components["schemas"]["SandboxEgressRule"];

// A single environment variable passed to a sandbox.
export type EnvVar = components["schemas"]["EnvVar"];

// Paginated list payload returned by `sandboxes.list`.
export type SandboxListResponse = components["schemas"]["SandboxListResponse"];

// Metric series bundle returned by `sandboxes.metrics`.
export type SandboxMetricsResponse = components["schemas"]["SandboxMetricsResponse"];

// One named time series within a metrics response.
export type MetricSeries = components["schemas"]["MetricSeries"];

// A port exposed for credential-free preview URLs, with its public URL.
export type SandboxPort = components["schemas"]["SandboxPort"];

// A platform-managed sandbox runtime template, referenced as
// `sandbox_template_id` at create time.
export type SandboxTemplate = components["schemas"]["SandboxTemplate"];

// Catalogue category of a sandbox template ("standard" | "browser").
export type SandboxTemplateCategory = components["schemas"]["SandboxTemplateCategory"];

// Lifecycle status of a sandbox template ("active" | "deprecated" | "disabled").
export type SandboxTemplateStatus = components["schemas"]["SandboxTemplateStatus"];

// Paginated list payload returned by `templates.list`.
export type SandboxTemplateListResponse = components["schemas"]["SandboxTemplateListResponse"];

// A snapshot captured from a sandbox's filesystem.
export type SnapshotData = components["schemas"]["Snapshot"];

// Lifecycle status of a snapshot ("Pending" | "Running" | "Ready" | "Failed").
export type SnapshotStatus = components["schemas"]["SnapshotStatus"];

// Caller-facing options for `sandbox.snapshot` / `sandboxes.createSnapshot`. The
// SDK fills in the rest of the request body.
export type CreateSnapshotParams = Omit<
  components["schemas"]["CreateSnapshotRequest"],
  "include_memory"
>;

// Paginated list payload returned by `sandboxes.listSnapshots`.
export type SnapshotListResponse = components["schemas"]["SnapshotListResponse"];

// An agent as returned by the API. The Agent handle class wraps this shape.
export type AgentData = components["schemas"]["Agent"];

// Lifecycle status of an agent, derived from its backing sandbox
// ("Provisioning" | "Ready" | "Paused" | "Failed" | "Deleting").
export type AgentStatus = components["schemas"]["AgentStatus"];

// Request body accepted by `agents.create`. Requires `name` and a catalogue
// `agent_template` name; the server provisions the backing sandbox from it.
export type CreateAgentParams = components["schemas"]["CreateAgentRequest"];

// Partial in-place update accepted by `agents.update` (egress and/or resources).
export type UpdateAgentParams = components["schemas"]["UpdateAgentRequest"];

// Paginated list payload returned by `agents.list`.
export type AgentListResponse = components["schemas"]["AgentListResponse"];

// A platform-managed agent template, referenced by name at agent create time.
export type AgentTemplate = components["schemas"]["AgentTemplate"];

// Paginated list payload returned by `agentTemplates.list`.
export type AgentTemplateListResponse = components["schemas"]["AgentTemplateListResponse"];
