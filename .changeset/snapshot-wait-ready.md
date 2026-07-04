---
"@neevcloud/sdk": minor
---

Add a snapshot readiness wait so you no longer hand-write a poll loop. `neev.sandboxes.waitForSnapshot(snapshotId)` resolves once a snapshot reaches `Ready` (and throws with the error message if it fails or the wait times out), and `sandbox.snapshot({ waitUntilReady: true })` captures and waits in one call.
