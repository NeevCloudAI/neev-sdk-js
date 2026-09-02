---
"@neevcloud/sdk": minor
---

Add in-place update for sandboxes and extend it for agents. `sandboxes.update(id, params)` and `sandbox.update(params)` are new: they resize `resources` (cpu/memory) and/or replace the `egress` policy on a running sandbox via a single `PATCH`, keeping its id, name, and preview URLs. `agents.update` / `agent.update` now accept the same `allowInternet` / `allowEgress` egress convenience that `create` uses.

At least one of `resources` or `egress` is required — an empty patch throws `NeevError` before any request is sent, naming both fields. `disk_gb` is not resizable in place; changing it surfaces the server's rejection rather than being silently dropped. `egress` replaces the policy in full and takes effect for new connections with no restart. The convenience shape produces byte-identical JSON to the equivalent `create()` call.

Adds the `UpdateSandboxParams` type (exported) and extends `UpdateAgentParams` with `EgressConvenience`.
