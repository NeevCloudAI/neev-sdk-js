// Public entry point for @neevcloud/sdk. Re-exports the client, resource types,
// the Sandbox handle, and the typed error hierarchy.

export { Neev } from "./client.js";
export type { NeevOptions, Scope } from "./client.js";

export { RawClient } from "./http.js";
export type { FetchLike, RawRequest } from "./http.js";

export { Sandbox } from "./sandbox.js";
export type { SnapshotWaitOptions, WaitOptions } from "./sandbox.js";

export { Agent } from "./agent.js";
export type { AgentWaitOptions } from "./agent.js";

export { SandboxConnection, SandboxFiles } from "./sandboxd.js";
export type {
  ExecOptions,
  ExecResult,
  ExecStreamEvent,
  FileEntry,
  ListFilesOptions,
  ReadFileOptions,
  WriteFileOptions,
  WriteFileResult,
} from "./sandboxd.js";

export { Process, SandboxProcesses, Signal } from "./processes.js";
export type {
  ProcessInfo,
  ProcessLogEntry,
  ProcessLogEvent,
  ProcessLogsOptions,
  ProcessLogsPage,
  ProcessRequestOptions,
  ProcessState,
  ProcessStatus,
  ProcessStatusOptions,
  StartProcessOptions,
} from "./processes.js";

export { PtyHandle, SandboxPty } from "./pty.js";
export type {
  PtyCreateOptions,
  PtyResult,
  SandboxWebSocket,
  WebSocketFactory,
} from "./pty.js";

export type {
  GetPortUrlOptions,
  ListSandboxesParams,
  MetricsParams,
  MetricsQuery,
  SandboxPage,
  WaitForSnapshotParams,
} from "./resources/sandboxes.js";

export type {
  ListTemplatesParams,
  SandboxTemplatePage,
} from "./resources/templates.js";

export type { AgentPage, ListAgentsParams } from "./resources/agents.js";

export type {
  AgentTemplatePage,
  ListAgentTemplatesParams,
} from "./resources/agent-templates.js";

export type {
  AgentData,
  AgentListResponse,
  AgentStatus,
  AgentTemplate,
  AgentTemplateListResponse,
  CreateAgentParams,
  CreateSandboxParams,
  CreateSnapshotParams,
  EnvVar,
  MetricSeries,
  SandboxData,
  SandboxEgressConfig,
  SandboxEgressRule,
  SandboxListResponse,
  SandboxMetricsResponse,
  SandboxPhase,
  SandboxPort,
  SandboxResources,
  SandboxTemplate,
  SandboxTemplateCategory,
  SandboxTemplateListResponse,
  SandboxTemplateStatus,
  SnapshotData,
  SnapshotListResponse,
  SnapshotStatus,
  UpdateAgentParams,
} from "./types.js";

export {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  DeadlineExceededError,
  InternalServerError,
  NeevError,
  NotFoundError,
  PermissionDeniedError,
  PreconditionFailedError,
  RateLimitError,
} from "./errors.js";
export type { ApiErrorBody } from "./errors.js";
