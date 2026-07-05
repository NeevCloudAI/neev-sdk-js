---
"@neevcloud/sdk": minor
---

Add preview URLs for sandbox ports. `sandbox.getUrl({ port })` exposes a port and returns its public, credential-free preview URL, waiting until the URL is routable before it resolves. Lower-level `sandbox.exposePort`, `listPorts`, and `revokePort` (and the `SandboxPort` type) are exposed for direct control.
