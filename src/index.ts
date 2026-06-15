// Public entry point for @neevcloud/sdk. Re-exports the client, resource types,
// the Sandbox handle, and the typed error hierarchy.

export { Neev } from "./client.js";
export type { NeevOptions, Scope } from "./client.js";

export { RawClient } from "./http.js";
export type { FetchLike, RawRequest } from "./http.js";

export { Sandbox } from "./sandbox.js";
export type { WaitOptions } from "./sandbox.js";

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

export type {
  ListSandboxesParams,
  MetricsParams,
  MetricsQuery,
  SandboxPage,
} from "./resources/sandboxes.js";

export type {
  ListTemplatesParams,
  SandboxTemplatePage,
} from "./resources/templates.js";

export type {
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
  SandboxResources,
  SandboxTemplate,
  SandboxTemplateCategory,
  SandboxTemplateListResponse,
  SandboxTemplateStatus,
  SnapshotData,
  SnapshotListResponse,
  SnapshotStatus,
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
