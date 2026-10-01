import type { Scope } from "./client.js";
import { NeevError } from "./errors.js";
import type { FetchLike } from "./http.js";

// Preview-URL options and the readiness poll shared by sandbox and agent ports.

// Defaults for the preview-URL readiness poll.
const DEFAULT_PORT_WAIT_TIMEOUT_MS = 60_000;
const DEFAULT_PORT_POLL_INTERVAL_MS = 2_000;

// Options for exposePort. The preview URL needs no credential — its slug is the
// only thing gating it — so treat the URL as a secret.
export interface ExposePortOptions {
  // Slug for the preview URL: exactly 8 lowercase letters and digits. Omit it and a
  // random, unguessable one is generated. Supplying a different slug on a port that
  // is already exposed replaces it and breaks the previous URL, which is how you
  // rotate a leaked preview URL. A slug you choose is a name, not a secret.
  slug?: string;
}

// Parameters for the resource-level exposePort: the slug option plus an optional
// scope override, so a scope passed as the third argument keeps working.
export interface ExposePortParams extends Scope, ExposePortOptions {}

// Options for getPortUrl / getUrl: the optional slug, whether to wait for the
// preview URL to become routable, and the poll timing while waiting.
export interface GetPortUrlOptions extends ExposePortOptions {
  // Poll the preview URL until it is routable before returning. Defaults to true.
  waitUntilReady?: boolean;
  // Overall wait budget in milliseconds. Defaults to 60000.
  timeoutMs?: number;
  // Delay between probes in milliseconds. Defaults to 2000.
  pollIntervalMs?: number;
}

// Builds the expose-port request body, sending `slug` only when one was chosen.
export function exposePortBody(port: number, options: ExposePortOptions) {
  return options.slug === undefined ? { port } : { port, slug: options.slug };
}

// Polls a preview URL until it is routed (it stops returning the
// not-yet-provisioned 403/404, and any connection error clears). Throws on
// timeout. Note: a successful probe means the URL is routable — the server
// behind the port must still be listening to answer a real request.
export async function waitForPreviewUrl(
  fetch: FetchLike,
  url: string,
  options: GetPortUrlOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PORT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_PORT_POLL_INTERVAL_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new NeevError(`getUrl: timeoutMs must be a positive, finite number (got ${timeoutMs}).`);
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new NeevError(
      `getUrl: pollIntervalMs must be a positive, finite number (got ${pollIntervalMs}).`,
    );
  }
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new NeevError(`Preview URL ${url} was not routable within ${timeoutMs}ms.`);
    }
    // Bound each probe to the remaining budget so a stalled request can't outlast the deadline.
    if (await previewUrlReachable(fetch, url, remaining)) return;
    const wait = Math.min(pollIntervalMs, deadline - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

// Probes a preview URL to decide whether it is routed yet.
// Right after a port is exposed the route is not yet live: the request either
// fails to connect or answers 403/404 for the not-yet-routed URL.
// Once routed, requests reach the sandbox (any other status, including a
// 502 when nothing is listening yet), which counts as reachable.
async function previewUrlReachable(
  fetch: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    return res.status !== 403 && res.status !== 404;
  } catch {
    // A connection error, DNS failure, or an abort when the budget ran out — not reachable yet.
    return false;
  } finally {
    clearTimeout(timer);
  }
}
