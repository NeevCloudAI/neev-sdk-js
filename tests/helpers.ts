import type { FetchLike } from "../src/http.js";
import type {
  AgentData,
  AgentTemplate,
  SandboxData,
  SandboxTemplate,
  SnapshotData,
} from "../src/types.js";

// A single recorded fetch call, for asserting method/url/headers/body in tests.
export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  // Body parsed as JSON when possible, else the raw text.
  body: unknown;
  // Raw request body bytes, for binary-body assertions.
  bodyBytes: Uint8Array;
  // The request's abort signal (always present on a Request).
  signal: AbortSignal;
}

// A scripted fetch and the log of calls made against it.
export interface MockFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
}

// Builds a JSON Response with the given status, body, and headers.
export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const init: ResponseInit = { status, headers: { ...headers } };
  if (body === undefined) {
    return new Response(null, init);
  }
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...headers },
  });
}

// Creates a base fetch that returns the queued responses in order, recording
// every call. The dispatch layer and openapi-fetch both call fetch with a
// Request, so the recorder reads method/url/headers/body off the Request. A
// queued Error simulates a transport-level failure.
export function mockFetch(queue: Array<Response | Error>): MockFetch {
  const calls: RecordedCall[] = [];
  const pending = [...queue];
  const fetch: FetchLike = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const bodyBytes = new Uint8Array(await req.clone().arrayBuffer());
    const text = new TextDecoder().decode(bodyBytes);
    calls.push({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: parseMaybeJson(text),
      bodyBytes,
      signal: req.signal,
    });
    const next = pending.shift();
    if (!next) throw new Error("mockFetch: no more queued responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

// Parses a recorded request body as JSON, falling back to the raw text (or
// undefined when empty) so a non-JSON body never throws inside the recorder.
function parseMaybeJson(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Builds a Sandbox record with sensible defaults, overridable per field.
export function sandboxData(overrides: Partial<SandboxData> = {}): SandboxData {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    org_id: "org_test",
    project_id: "proj_test",
    name: "test-sandbox",
    region: "as-south-1",
    image: "ghcr.io/neevcloud/sandbox-python:3.12",
    sandbox_template_id: "sb-ubuntu-26-04-minimal",
    phase: "Pending",
    replicas: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

// Builds a Snapshot record with sensible defaults, overridable per field.
export function snapshotData(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    sandbox_id: "11111111-1111-1111-1111-111111111111",
    org_id: "org_test",
    project_id: "proj_test",
    status: "Pending",
    snapshot_type: "full",
    source_region: "as-south-1",
    sandbox_format_version: 1,
    restorability: "restorable",
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

// Builds a SandboxTemplate record with sensible defaults, overridable per field.
export function templateData(overrides: Partial<SandboxTemplate> = {}): SandboxTemplate {
  return {
    id: "sb-ubuntu-26-04-minimal",
    name: "Ubuntu 26.04 Minimal",
    description: "Minimal Ubuntu 26.04 sandbox runtime.",
    category: "standard",
    status: "active",
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

// Builds an Agent record with sensible defaults, overridable per field.
export function agentData(overrides: Partial<AgentData> = {}): AgentData {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    org_id: "org_test",
    project_id: "proj_test",
    name: "test-agent",
    agent_template_id: "ag-claude-code",
    sandbox_id: "11111111-1111-1111-1111-111111111111",
    status: "Provisioning",
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

// Builds an AgentTemplate record with sensible defaults, overridable per field.
export function agentTemplateData(overrides: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "ag-claude-code",
    name: "claude-code",
    description: "Claude Code coding agent.",
    category: "coding",
    status: "active",
    ui: { mode: "tui" },
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}
