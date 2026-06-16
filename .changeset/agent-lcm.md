---
"@neevcloud/sdk": minor
---

Add an agent lifecycle surface: `neev.agents` and `neev.agentTemplates`.

Provision a packaged agent from a catalogue template onto its own backing sandbox (1:1), then manage it through a handle.

- `neev.agents` — `create(params, scope?)`, `list(params?)` (paginated), `get(id, scope?)`, `update(id, params, scope?)` (in-place egress and cpu/memory; disk is not resizable), `pause(id, scope?)`, `resume(id, scope?)`, `delete(id, scope?)`. Every method returns an `Agent` handle (or a page of handles).
- `Agent` handle — `id`, `name`, `status`, `templateId`, `sandboxId`, `config`, `data`/`toJSON()`, plus `refresh()`, `update()`, `pause()`, `resume()`, `delete()`, and `waitUntilReady()` (polls until `Ready`; fails fast on `Failed` and on `Paused`). `agent.sandbox()` resolves the backing sandbox as a `Sandbox` handle so callers can reach its `files`/`exec`/`processes`.
- `neev.agentTemplates` — read-only catalogue: `list()` (paginated) and `get(id)`. The template `name` (e.g. `claude-code`) is passed as `agent_template` at create.
- Exports `Agent`, the `AgentWaitOptions` / `AgentPage` / `ListAgentsParams` / `AgentTemplatePage` / `ListAgentTemplatesParams` option types, and the `AgentData` / `AgentStatus` / `CreateAgentParams` / `UpdateAgentParams` / `AgentListResponse` / `AgentTemplate` / `AgentTemplateListResponse` types.
