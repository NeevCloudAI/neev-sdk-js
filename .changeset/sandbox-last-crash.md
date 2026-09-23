---
"@neevcloud/sdk": minor
---

Expose a sandbox's most recent unexpected stop as `sandbox.lastCrash`, and an agent's as `agent.lastCrash`. Every read path that returns a handle — `create`, `get`, `list().items`, `refresh`, `pause`/`resume`, `update` — carries it, and the raw field stays available as `sandbox.data.last_crash`.

`lastCrash` is `null` when the sandbox has never crashed, otherwise `{ reason, at, storage_reset }`. `storage_reset: true` means the sandbox restarted with an empty filesystem: files under `/workspace`, and anything installed since create, are gone; `false` means the files survived the restart. Until now an SDK caller could not tell a restarted sandbox from one that had simply lost its files — it read back as Ready with an empty workspace.

The record is historical and is not cleared when the sandbox recovers, so compare `at` against when you last trusted the filesystem rather than treating a non-`null` value as "broken right now". The handle holds a cached snapshot — call `refresh()` to pick up a crash detected after the record was fetched.

Adds the exported types `SandboxLastCrash` and `AgentLastCrash`.
