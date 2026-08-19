---
"@neevcloud/sdk": minor
---

Add `sandboxes.update(id, { resources })` and `sandbox.update({ resources })`, which resize a sandbox's `cpu` and `memory_gb` in place on the running sandbox — no restart, and fields you omit are left unchanged. `disk_gb` is fixed at creation and is rejected if you supply a different value. The endpoint already existed; the vendored spec was missing the `PATCH` operation, so the SDK had no way to call it. A sandbox that backs an agent is resized through `agents.update` instead, and a resize is refused while a snapshot capture is in flight.

Also drops the removed `preserve_memory` field from the pause request body. A pause now always captures the sandbox's full state — root filesystem, process memory, and workspace — and a resume always restores from that implicit snapshot; there is no opt-out and no volume-only mode.
