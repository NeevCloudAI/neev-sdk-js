import createClient, { type Client } from "openapi-fetch";
import { NeevError } from "./errors.js";
import { type Dispatch, type FetchLike, RawClient, createDispatch } from "./http.js";
import type { WebSocketFactory } from "./pty.js";
import { AgentTemplates } from "./resources/agent-templates.js";
import { Agents } from "./resources/agents.js";
import { Sandboxes } from "./resources/sandboxes.js";
import { SandboxTemplates } from "./resources/templates.js";
import { SandboxConnection } from "./runtime.js";

// Per-call override of the org/project the request targets. When omitted, the
// client-level defaults (constructor args or NEEV_* env vars) are used.
export interface Scope {
  orgId?: string;
  projectId?: string;
}

// Configuration accepted by the Neev constructor. Every field is optional and
// falls back to a NEEV_* environment variable or a built-in default.
export interface NeevOptions {
  // Bearer API key. Falls back to NEEV_API_KEY. Required.
  apiKey?: string;
  // Default organization id. Falls back to NEEV_ORG_ID.
  orgId?: string;
  // Default project id. Falls back to NEEV_PROJECT_ID.
  projectId?: string;
  // Base URL of the Neev API. Falls back to NEEV_BASE_URL, then the default host.
  baseURL?: string;
  // Per-request timeout in milliseconds. Defaults to 60000.
  timeoutMs?: number;
  // Maximum retries for transient failures (network, 429, 5xx). Defaults to 2.
  maxRetries?: number;
  // Custom fetch implementation. Defaults to the runtime's global fetch.
  fetch?: FetchLike;
  // WebSocket factory for interactive PTY sessions (`sandbox.pty`). Defaults to the
  // runtime's global WebSocket if present. In Node, pass one backed by the `ws` package so
  // the auth header is sent: `webSocket: (url, opts) => new WebSocket(url, opts)`.
  webSocket?: WebSocketFactory;
}

// Internal contract the resource classes depend on. Provides both a typed,
// spec-driven client (createTypedClient) and an untyped escape hatch (raw) for
// endpoints that do not have an OpenAPI spec yet — both share one transport.
export interface RequestContext {
  // Builds an openapi-fetch client for a service's generated `paths` type.
  createTypedClient<Paths extends {}>(): Client<Paths>;
  // Untyped client for spec-less endpoints.
  readonly raw: RawClient;
  // Opens a connection to a sandbox runtime at its connect_url. Uses a no-retry
  // transport so non-idempotent sandbox calls never double-fire.
  createSandboxConnection(connectUrl: string): SandboxConnection;
  // Resolves the effective org/project for a call.
  resolveScope(scope?: Scope): { orgId: string; projectId: string };
  // The configured fetch, for probing arbitrary URLs (e.g. a preview URL) outside
  // the API base.
  readonly fetch: FetchLike;
}

// Default base URL of the Neev production API.
const DEFAULT_BASE_URL = "https://api.ai.neevcloud.com/agent";
// Default per-request timeout in milliseconds.
const DEFAULT_TIMEOUT_MS = 60_000;
// Default number of retries for transient failures.
const DEFAULT_MAX_RETRIES = 2;

// The Neev platform client. Construct once and reuse; resource namespaces such
// as `sandboxes` hang off the instance.
export class Neev implements RequestContext {
  // Untyped client for endpoints that do not have an OpenAPI spec yet.
  readonly raw: RawClient;
  // Sandbox lifecycle operations.
  readonly sandboxes: Sandboxes;
  // Read-only sandbox-template catalogue (template ids for `sandboxes.create`).
  readonly templates: SandboxTemplates;
  // Agent lifecycle operations.
  readonly agents: Agents;
  // Read-only agent-template catalogue (template names for `agents.create`).
  readonly agentTemplates: AgentTemplates;

  // The configured fetch, exposed for probing non-API URLs (e.g. preview URLs).
  readonly fetch: FetchLike;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly dispatch: Dispatch;
  private readonly directDispatch: Dispatch;
  private readonly defaultOrgId?: string;
  private readonly defaultProjectId?: string;
  private readonly webSocket?: WebSocketFactory;

  constructor(options: NeevOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("NEEV_API_KEY");
    if (!apiKey) {
      throw new NeevError(
        "Missing API key. Pass `apiKey` or set the NEEV_API_KEY environment variable.",
      );
    }

    const baseFetch = options.fetch ?? globalThis.fetch;
    if (!baseFetch) {
      throw new NeevError(
        "No global fetch found. Use Node 18+, Bun, Deno, or pass a `fetch` implementation.",
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = options.baseURL ?? readEnv("NEEV_BASE_URL") ?? DEFAULT_BASE_URL;
    this.defaultOrgId = options.orgId ?? readEnv("NEEV_ORG_ID");
    this.defaultProjectId = options.projectId ?? readEnv("NEEV_PROJECT_ID");
    this.webSocket = options.webSocket;
    const boundFetch = baseFetch.bind(globalThis);
    this.fetch = boundFetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dispatch = createDispatch({
      fetch: boundFetch,
      timeoutMs,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    });
    // Sandbox calls never retry: exec/write are not idempotent, so a retried
    // 5xx could run a command or write a file twice.
    this.directDispatch = createDispatch({ fetch: boundFetch, timeoutMs, maxRetries: 0 });

    this.raw = new RawClient({ baseUrl: this.baseUrl, apiKey, dispatch: this.dispatch });
    this.sandboxes = new Sandboxes(this);
    this.templates = new SandboxTemplates(this);
    // Agents reuse the sandboxes resource so an Agent handle can resolve its
    // backing sandbox; construct sandboxes first.
    this.agents = new Agents(this, this.sandboxes);
    this.agentTemplates = new AgentTemplates(this);
  }

  // Opens a connection to a sandbox runtime at its connect_url, backed by this
  // client's bearer auth and the no-retry transport.
  createSandboxConnection(connectUrl: string): SandboxConnection {
    return new SandboxConnection({
      connectUrl,
      apiKey: this.apiKey,
      dispatch: this.directDispatch,
      webSocket: this.webSocket,
    });
  }

  // Builds a typed openapi-fetch client for a service's generated `paths` type,
  // backed by this client's shared transport and bearer auth.
  createTypedClient<Paths extends {}>(): Client<Paths> {
    return createClient<Paths>({
      baseUrl: this.baseUrl,
      fetch: this.dispatch,
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }

  // Resolves the effective org/project for a call, preferring the per-call
  // override and falling back to the client defaults. Throws if either is unset.
  resolveScope(scope?: Scope): { orgId: string; projectId: string } {
    const orgId = scope?.orgId ?? this.defaultOrgId;
    const projectId = scope?.projectId ?? this.defaultProjectId;
    if (!orgId) {
      throw new NeevError("Missing orgId. Set it on the client, via NEEV_ORG_ID, or per call.");
    }
    if (!projectId) {
      throw new NeevError(
        "Missing projectId. Set it on the client, via NEEV_PROJECT_ID, or per call.",
      );
    }
    return { orgId, projectId };
  }
}

// Reads an environment variable when running on a platform that exposes
// `process.env`; returns undefined on runtimes without it.
function readEnv(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return undefined;
}
