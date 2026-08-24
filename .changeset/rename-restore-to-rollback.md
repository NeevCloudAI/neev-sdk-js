---
"@neevcloud/sdk": minor
---

Rename the in-place snapshot revert from `restore` to `rollback` to match platform terminology. `sandboxes.restore(id, snapshotId)` and `sandbox.restore(snapshotId)` are now `sandboxes.rollback(id, snapshotId)` and `sandbox.rollback(snapshotId)`, and the call targets the new `POST .../sandboxes/{id}/rollback` endpoint.

The naming now distinguishes **rollback** (revert an existing sandbox to a previous snapshot, in place) from **restore** (create a new sandbox from a snapshot, via `sandboxes.create({ restore })`). The create-from-snapshot field is `restore`; the older `from_snapshot` field remains as a deprecated alias.

**Breaking:** call sites using `restore` for in-place revert must switch to `rollback`.
