import type { Scope } from "./client.js";
import { NeevError } from "./errors.js";
import type { Agents } from "./resources/agents.js";
import type { Sandbox } from "./sandbox.js";
import type { AgentData, AgentStatus, UpdateAgentParams } from "./types.js";

// Options controlling how long `waitUntilReady` polls before giving up.
export interface AgentWaitOptions {
  // Maximum time to wait for the Ready status, in milliseconds. Defaults to 120000.
  timeoutMs?: number;
  // Delay between status polls, in milliseconds. Defaults to 2000.
  pollIntervalMs?: number;
}

// Default overall wait budget for waitUntilReady, in milliseconds.
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
// Default delay between status polls, in milliseconds.
const DEFAULT_POLL_INTERVAL_MS = 2_000;

// A live handle to a single agent. Carries the latest known server state and
// offers lifecycle actions that operate on this agent in place. An agent runs on
// a 1:1 backing sandbox; `sandbox()` resolves that sandbox so callers can reach
// its files/exec/processes. Construct via the `agents` resource, not directly.
export class Agent {
  private readonly agents: Agents;
  private readonly scope?: Scope;
  private state: AgentData;

  constructor(agents: Agents, data: AgentData, scope?: Scope) {
    this.agents = agents;
    this.state = data;
    this.scope = scope;
  }

  // Agent UUID.
  get id(): string {
    return this.state.id;
  }

  // Human-readable agent name (also the backing sandbox's name).
  get name(): string {
    return this.state.name;
  }

  // Current lifecycle status as last seen from the server.
  get status(): AgentStatus {
    return this.state.status;
  }

  // Catalogue template id the agent was created from (e.g. "ag-claude-code").
  get templateId(): string {
    return this.state.agent_template_id;
  }

  // UUID of the backing sandbox that runs this agent.
  get sandboxId(): string {
    return this.state.sandbox_id;
  }

  // Effective agent configuration (template defaults merged with create-time
  // overrides), or undefined when the server reported none.
  get config(): Record<string, unknown> | undefined {
    return this.state.config;
  }

  // Full raw agent record exactly as returned by the API.
  get data(): AgentData {
    return this.state;
  }

  // Returns the raw record so JSON.stringify(agent) emits the API shape.
  toJSON(): AgentData {
    return this.state;
  }

  // Resolves the agent's backing sandbox as a Sandbox handle, so callers can use
  // its files/exec/processes. Each call fetches the current sandbox state.
  async sandbox(): Promise<Sandbox> {
    return this.agents.getSandbox(this.sandboxId, this.scope);
  }

  // Re-fetches the agent and updates this handle's state in place.
  async refresh(): Promise<this> {
    const fresh = await this.agents.get(this.id, this.scope);
    this.state = fresh.data;
    return this;
  }

  // Updates the agent in place (egress and/or cpu/memory) and updates this handle.
  async update(params: UpdateAgentParams): Promise<this> {
    const next = await this.agents.update(this.id, params, this.scope);
    this.state = next.data;
    return this;
  }

  // Pauses the agent (suspends its backing sandbox) and updates this handle.
  async pause(): Promise<this> {
    const next = await this.agents.pause(this.id, this.scope);
    this.state = next.data;
    return this;
  }

  // Resumes the agent and updates this handle.
  async resume(): Promise<this> {
    const next = await this.agents.resume(this.id, this.scope);
    this.state = next.data;
    return this;
  }

  // Permanently deletes the agent and its backing sandbox.
  async delete(): Promise<void> {
    await this.agents.delete(this.id, this.scope);
  }

  // Polls until the agent reaches the Ready status, then resolves with this
  // handle. Fails fast on a terminal Failed status and on Paused (it will not
  // become Ready on its own — call resume() first), and throws a NeevError if the
  // timeout elapses first.
  async waitUntilReady(options: AgentWaitOptions = {}): Promise<this> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;

    // Poll the live status until Ready, a terminal/blocking state, or the deadline.
    while (true) {
      if (this.status === "Ready") return this;
      if (this.status === "Failed") {
        throw new NeevError(`Agent ${this.id} failed to provision and will not become Ready.`);
      }
      if (this.status === "Paused") {
        throw new NeevError(
          `Agent ${this.id} is Paused and will not become Ready; call resume() first.`,
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new NeevError(
          `Agent ${this.id} did not become Ready within ${timeoutMs}ms (status: ${this.status}).`,
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
