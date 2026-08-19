---
"@neevcloud/sdk": minor
---

Add `sandboxes.update(id, { resources })` and `sandbox.update({ resources })` to resize a sandbox's `cpu` / `memory_gb` in place, without a restart (`disk_gb` stays fixed at creation), plus `sandboxes.createConnectToken(id)` and `sandbox.createConnectToken()`, which mint a short-lived `{ token, expires_in }` bearer credential for calling a sandbox's `connectUrl` directly instead of distributing the API key. Both endpoints already existed on the platform; the vendored spec had not caught up. The spec also drops the removed `preserve_memory` field from the pause body — a pause always captures the sandbox's full state (root filesystem, process memory, and workspace), and a resume always restores from that implicit snapshot.
