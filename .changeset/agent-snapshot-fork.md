---
"@neevcloud/sdk": minor
---

Agents can be snapshotted and forked. `neev.agents.createSnapshot(id, params?)` and `listSnapshots(id, params?)` snapshot the sandbox backing an agent and list those snapshots, with the same params and `SnapshotData` shape as the sandbox calls. `neev.agents.fork(id, name)` forks an agent into a new agent with the source's template and configuration; it returns the new `Agent`, which is `Provisioning` until `waitUntilReady()`, and the source keeps running. The `Agent` handle gains `snapshot(options?)` (with `{ waitUntilReady: true }`), `snapshots(params?)` and `fork(name)`.

`CreateSnapshotParams` takes `snapshot_type`: `"filesystem"` captures /workspace only, without process memory, so it can be restored onto any sandbox image; `"full"` captures both.

A new `TooEarlyError` is thrown for HTTP 425, such as calling an agent that is still provisioning. It was a plain `APIError` before.

The audit trail now also records every program that runs in a sandbox, unless its `execution_trace` is turned off: a Process Activity event (`class_uid` 1007) for a program starting or ending, with `process` and `exit_code`, and a Network Activity event (4001) for a connection it opened. These events have no `api`, so check `e.api` before reading `e.api.operation`. Every event carries `device` (the sandbox) and `cloud.org`. `actor.user.type` is now `User`, `API Key`, `System` or `Unknown`; the `actorType` filter still takes `"user"`, `"api_key"` and `"system"`.
