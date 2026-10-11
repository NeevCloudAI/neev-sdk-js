---
"@neevcloud/sdk": minor
---

Sandbox labels: tag a sandbox at create time with `neev.sandboxes.create({ labels: { team: "payments", "ci-run": "4821" } })`, read them back as `sandbox.labels` (`{}` when none), and find sandboxes by label with `neev.sandboxes.list({ labels: { team: "payments" } })`, which keeps only sandboxes carrying every given label. Up to 16 labels; the server checks their format and rejects a bad one with `BadRequestError`. The new `SandboxLabels` type is exported.
