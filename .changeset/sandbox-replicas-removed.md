---
"@neevcloud/sdk": minor
---

`sandbox.replicas` is removed; read `sandbox.phase` instead, which is `"Paused"` while a sandbox is paused. The field is deprecated in the API and is now optional on the generated `Sandbox` type.

`snapshot_type` adds `"filesystem"` for a files-only snapshot that cannot be restored.
