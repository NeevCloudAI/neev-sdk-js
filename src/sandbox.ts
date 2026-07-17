import type { Scope } from "./client.js";
import { NeevError } from "./errors.js";
import { SandboxProcesses } from "./processes.js";
import { SandboxPty } from "./pty.js";
import type {
  GetPortUrlOptions,
  ListSnapshotsParams,
  MetricsQuery,
  Sandboxes,
  SnapshotPage,
} from "./resources/sandboxes.js";
import { SandboxFiles } from "./runtime.js";
import type { ExecOptions, ExecResult, ExecStreamEvent, SandboxConnection } from "./runtime.js";
import { openSshTunnel } from "./ssh.js";
import type { SshTunnel, SshTunnelOptions } from "./ssh.js";
import type {
  CreateSnapshotParams,
  SandboxData,
  SandboxMetricsResponse,
  SandboxPhase,
  SandboxPort,
  SandboxResources,
  SnapshotData,
} from "./types.js";

// Options controlling how long `waitUntilReady` polls before giving up.
export interface WaitOptions {
  // Maximum time to wait for the Ready phase, in milliseconds. Defaults to 120000.
  timeoutMs?: number;
  // Delay between status polls, in milliseconds. Defaults to 2000.
  pollIntervalMs?: number;
}

// Options for `sandbox.snapshot`: whether to block until the snapshot is Ready,
// plus the poll timing applied while waiting.
export interface SnapshotWaitOptions extends WaitOptions {
  // When true, block until the snapshot finishes capturing (status Ready) and
  // return the completed snapshot. When false (the default) return the Pending
  // snapshot immediately.
  waitUntilReady?: boolean;
}

// Default overall wait budget for waitUntilReady, in milliseconds.
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
// Default delay between status polls, in milliseconds.
const DEFAULT_POLL_INTERVAL_MS = 2_000;

// A live handle to a single sandbox. Carries the latest known server state and
// offers lifecycle actions that operate on this sandbox in place. Construct via
// the `sandboxes` resource rather than directly.
export class Sandbox {
  private readonly sandboxes: Sandboxes;
  private readonly scope?: Scope;
  private state: SandboxData;
  // Cached sandbox connection and the connect_url it was built for, so the
  // connection is reused across calls but rebuilt if the URL changes.
  private conn?: SandboxConnection;
  private connUrl?: string;
  // In-flight connection resolution, shared so concurrent first calls trigger a
  // single readiness wait rather than one poll loop each.
  private connecting?: Promise<SandboxConnection>;
  // Cached files facade; its connection is resolved lazily on first use.
  private filesProxy?: SandboxFiles;
  // Cached processes facade; its connection is resolved lazily on first use.
  private processesProxy?: SandboxProcesses;
  // Cached pty facade; its connection is resolved lazily on first use.
  private ptyProxy?: SandboxPty;

  constructor(sandboxes: Sandboxes, data: SandboxData, scope?: Scope) {
    this.sandboxes = sandboxes;
    this.state = data;
    this.scope = scope;
  }

  // Sandbox UUID.
  get id(): string {
    return this.state.id;
  }

  // Human-readable sandbox name.
  get name(): string {
    return this.state.name;
  }

  // Current lifecycle phase as last seen from the server.
  get phase(): SandboxPhase {
    return this.state.phase;
  }

  // Desired replica count (0 when paused, 1 when running).
  get replicas(): number {
    return this.state.replicas;
  }

  // Direct address of the sandbox runtime, or null when not configured.
  get connectUrl(): string | null {
    return this.state.connect_url ?? null;
  }

  // Region slug the sandbox runs in.
  get region(): string {
    return this.state.region;
  }

  // Catalogue template id the sandbox was created from, or null when unknown.
  get templateId(): string | null {
    return this.state.sandbox_template_id ?? null;
  }

  // Compute size the sandbox was provisioned with, or undefined when defaulted.
  get resources(): SandboxResources | undefined {
    return this.state.resources;
  }

  // Filesystem operations on this sandbox's runtime. Each operation resolves the
  // connection lazily: if the sandbox has no connect_url yet, the first call
  // waits until it is Ready to obtain one.
  get files(): SandboxFiles {
    if (!this.filesProxy) {
      this.filesProxy = new SandboxFiles(() => this.ensureConnection());
    }
    return this.filesProxy;
  }

  // Process supervisor operations on this sandbox's runtime. Like `files`, each
  // operation resolves the connection lazily, waiting until the sandbox is Ready
  // on first use to obtain its connect_url.
  get processes(): SandboxProcesses {
    if (!this.processesProxy) {
      this.processesProxy = new SandboxProcesses(() => this.ensureConnection());
    }
    return this.processesProxy;
  }

  // Interactive PTY sessions on this sandbox's runtime. Like `files`, the connection
  // resolves lazily, waiting until the sandbox is Ready on first use.
  get pty(): SandboxPty {
    if (!this.ptyProxy) {
      this.ptyProxy = new SandboxPty(() => this.ensureConnection());
    }
    return this.ptyProxy;
  }

  // Opens an SSH tunnel to this sandbox: a loopback TCP listener that forwards each
  // connection over an authenticated WebSocket, so any ssh client or IDE points at the
  // returned { host, port } with no keys to manage and no public port. Waits for the
  // sandbox to be Ready on first use. Node only. Close the returned tunnel when done.
  async ssh(options: SshTunnelOptions = {}): Promise<SshTunnel> {
    const conn = await this.ensureConnection();
    return openSshTunnel(conn, options);
  }

  // Runs a command in the sandbox. By default it buffers and resolves to the full
  // ExecResult. Pass `{ stream: true }` to instead get a live async-iterable of
  // stdout/stderr chunks followed by a terminal exit event. Either way it waits
  // for the sandbox to be Ready on first use, and a non-zero exit is reported
  // (in the result or the exit event), never thrown.
  exec(
    command: string | string[],
    options: ExecOptions & { stream: true },
  ): AsyncGenerator<ExecStreamEvent>;
  exec(command: string | string[], options?: ExecOptions): Promise<ExecResult>;
  exec(
    command: string | string[],
    options: ExecOptions = {},
  ): Promise<ExecResult> | AsyncGenerator<ExecStreamEvent> {
    return options.stream ? this.streamExec(command, options) : this.bufferedExec(command, options);
  }

  /** @deprecated Use `exec(command, { stream: true })`. */
  execStream(
    command: string | string[],
    options: ExecOptions = {},
  ): AsyncGenerator<ExecStreamEvent> {
    return this.streamExec(command, options);
  }

  // Buffered exec: waits for the connection, then returns the full result.
  private async bufferedExec(
    command: string | string[],
    options: ExecOptions,
  ): Promise<ExecResult> {
    const conn = await this.ensureConnection();
    return conn.exec(command, options);
  }

  // Streaming exec: waits for the connection, then yields events as they arrive.
  private async *streamExec(
    command: string | string[],
    options: ExecOptions,
  ): AsyncGenerator<ExecStreamEvent> {
    const conn = await this.ensureConnection();
    yield* conn.execStream(command, options);
  }

  // Full raw sandbox record exactly as returned by the API.
  get data(): SandboxData {
    return this.state;
  }

  // Returns the raw record so JSON.stringify(sandbox) emits the API shape.
  toJSON(): SandboxData {
    return this.state;
  }

  // Re-fetches the sandbox and updates this handle's state in place.
  async refresh(): Promise<this> {
    const fresh = await this.sandboxes.get(this.id, this.scope);
    this.state = fresh.data;
    return this;
  }

  // Pauses the sandbox (scales to zero replicas) and updates this handle.
  async pause(): Promise<this> {
    const next = await this.sandboxes.pause(this.id, this.scope);
    this.state = next.data;
    return this;
  }

  // Resumes the sandbox (scales to one replica) and updates this handle.
  async resume(): Promise<this> {
    const next = await this.sandboxes.resume(this.id, this.scope);
    this.state = next.data;
    return this;
  }

  // Permanently deletes the sandbox.
  async delete(): Promise<void> {
    await this.sandboxes.delete(this.id, this.scope);
  }

  // Reads the live metric series for this sandbox.
  async metrics(params: MetricsQuery = {}): Promise<SandboxMetricsResponse> {
    return this.sandboxes.metrics(this.id, { ...params, ...this.scope });
  }

  // Exposes a port for credential-free preview URLs and returns its public URL.
  // The route is not live the instant the port is exposed, so by default this
  // waits until the URL is reachable before returning; pass
  // `{ waitUntilReady: false }` to return immediately, and timeoutMs/pollIntervalMs
  // to tune the wait.
  async getUrl(options: { port: number } & GetPortUrlOptions): Promise<string> {
    const { port, ...wait } = options;
    return this.sandboxes.getPortUrl(this.id, port, wait, this.scope);
  }

  // Exposes a port for preview URLs and returns it with its URL (no readiness
  // wait; use getUrl to wait until the URL is routable).
  async exposePort(port: number): Promise<SandboxPort> {
    return this.sandboxes.exposePort(this.id, port, this.scope);
  }

  // Lists the ports currently exposed for this sandbox's preview URLs.
  async listPorts(): Promise<SandboxPort[]> {
    return this.sandboxes.listPorts(this.id, this.scope);
  }

  // Revokes a previously exposed preview port.
  async revokePort(port: number): Promise<void> {
    return this.sandboxes.revokePort(this.id, port, this.scope);
  }

  // Captures a snapshot of this sandbox. By default the result starts Pending —
  // poll it (via sandboxes.getSnapshot / sandboxes.waitForSnapshot) until Ready
  // before restoring or forking. Pass { waitUntilReady: true } to block until the
  // snapshot is Ready and return the completed snapshot instead; timeoutMs and
  // pollIntervalMs tune that wait.
  async snapshot(options: CreateSnapshotParams & SnapshotWaitOptions = {}): Promise<SnapshotData> {
    // Split the client-side wait controls from the snapshot request body fields
    // (name, retain_for) so only the latter reach the create call.
    const { waitUntilReady, timeoutMs, pollIntervalMs, ...params } = options;
    const snapshot = await this.sandboxes.createSnapshot(this.id, params, this.scope);
    if (!waitUntilReady) return snapshot;
    return this.sandboxes.waitForSnapshot(snapshot.id, {
      ...this.scope,
      timeoutMs,
      pollIntervalMs,
    });
  }

  // Lists the snapshots taken from this sandbox. Paginated — pass page/limit and
  // read the returned page's metadata to page through every snapshot.
  async snapshots(params: ListSnapshotsParams = {}): Promise<SnapshotPage> {
    return this.sandboxes.listSnapshots(this.id, { ...params, ...this.scope });
  }

  // Restores this sandbox in place from one of its snapshots and updates the handle.
  async restore(snapshotId: string): Promise<this> {
    const next = await this.sandboxes.restore(this.id, snapshotId, this.scope);
    this.state = next.data;
    return this;
  }

  // Forks this sandbox into a new named sandbox seeded from its *current* live
  // state (the server snapshots the current state atomically); this sandbox keeps
  // running. It does not reuse an existing snapshot — use restore for that.
  // Returns a handle to the new sandbox.
  async fork(name: string): Promise<Sandbox> {
    return this.sandboxes.fork(this.id, name, this.scope);
  }

  // Resolves the sandbox connection for this sandbox, coalescing concurrent first
  // calls into one readiness wait. Subsequent calls re-resolve cheaply (the
  // sandbox is Ready and the connection is cached).
  private ensureConnection(): Promise<SandboxConnection> {
    if (!this.connecting) {
      this.connecting = this.resolveConnection().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  // Caches the sandbox connection by connect_url. Waits until the sandbox is Ready
  // when it has no usable endpoint yet (a freshly-created or just-resumed sandbox
  // reports no connect_url, or a stale non-Ready phase). The cached connection is
  // rebuilt if the connect_url changes (e.g. across a resume). Throws if the
  // sandbox is Ready but still exposes no connect_url.
  private async resolveConnection(): Promise<SandboxConnection> {
    if (!this.state.connect_url || this.phase !== "Ready") {
      await this.waitUntilReady();
    }
    const connectUrl = this.state.connect_url;
    if (!connectUrl) {
      throw new NeevError(
        `Sandbox ${this.id} is Ready but has no connect_url; runtime operations are unavailable.`,
      );
    }
    if (!this.conn || this.connUrl !== connectUrl) {
      this.conn = this.sandboxes.connect(connectUrl);
      this.connUrl = connectUrl;
    }
    return this.conn;
  }

  // Polls until the sandbox reaches the Ready phase, then resolves with this
  // handle. Fails fast if the sandbox is Paused (it will never become Ready on
  // its own) and throws a NeevError if the timeout elapses first.
  async waitUntilReady(options: WaitOptions = {}): Promise<this> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    // Reject non-finite or non-positive timings: they would otherwise produce a
    // near-zero-delay poll loop (or, for NaN, one that never times out).
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new NeevError(
        `waitUntilReady: timeoutMs must be a positive, finite number (got ${timeoutMs}).`,
      );
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new NeevError(
        `waitUntilReady: pollIntervalMs must be a positive, finite number (got ${pollIntervalMs}).`,
      );
    }
    const deadline = Date.now() + timeoutMs;

    // Poll the live phase until Ready, a terminal Paused state, or the deadline.
    while (true) {
      if (this.phase === "Ready") return this;
      if (this.phase === "Paused") {
        throw new NeevError(
          `Sandbox ${this.id} is Paused and will not become Ready; call resume() first.`,
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new NeevError(
          `Sandbox ${this.id} did not become Ready within ${timeoutMs}ms (phase: ${this.phase}).`,
        );
      }
      await sleep(Math.min(pollIntervalMs, remaining));
      await this.refresh();
    }
  }
}

// Resolves after the given number of milliseconds.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
