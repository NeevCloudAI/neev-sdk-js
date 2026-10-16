---
"@neevcloud/sdk": minor
---

The audit trail returns OCSF API Activity events. `AuditTrail.records` is replaced by `data: AuditEvent[]`, and each event carries who made the call (`actor.user`: a user, an API key, or the platform), the call (`api.operation`), what it touched (`resources`), `time` in milliseconds and `status`. `AuditTrail.sandbox_id` and the `AuditRecord` type are removed.

`sandboxes.audit`, `agents.audit` and the handles' `audit()` take new filters: `operation`, `status`, `actorType`, `actorUid` and `credentialUid`. `operation` and `actorType` take one value or an array.

Snapshots have an optional `trigger`: `"manual"`, or `"memory_pressure"` for one taken automatically as the sandbox neared its memory limit; it is absent from an API that predates it. Templates have `interpreter` and `min_memory_gb`.
