---
"@neevcloud/sdk": minor
---

Add optional `name`, `status`, and `sandboxId` filters to `sandboxes.list()`. `name` is a case-insensitive substring match on the sandbox name, `status` filters by lifecycle phase, and `sandboxId` narrows to a single sandbox; each combines with AND and is omitted when unset. Also adds the `Pausing` phase to `SandboxPhase`, which the platform reports while a pause is in flight.
