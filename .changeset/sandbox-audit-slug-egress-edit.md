---
"@neevcloud/sdk": minor
---

Sandboxes and agents: audit trail, rotatable preview URLs, in-place egress edits, and large-file transfer.

- `sandbox.audit()` / `neev.sandboxes.audit(id)` and `agent.audit()` / `neev.agents.audit(id)` read one page of what ran inside a sandbox — program names (never arguments), process and file operations, the credential each was made under, and how it ended. Page with `next_cursor`.
- Preview URLs are gated by a per-port slug. `exposePort(port, { slug })` and `getUrl({ port, slug })` choose one; exposing an exposed port with a different slug rotates it and breaks the old URL. `SandboxPort` now carries `slug`. On the resource method the slug rides alongside the scope: `neev.sandboxes.exposePort(id, port, { slug, orgId, projectId })`, so existing calls that pass a scope third are unchanged.
- `update()` accepts `egress_add` / `egress_remove` to edit the allow-list in place without restating it. Combining them with `egress` (or `allowInternet` / `allowEgress`) is rejected before the request. Egress rules now enforce their `ports` and `protocol`.
- Sandboxes and agents can be addressed by name wherever an id is accepted.
- `sandbox.addressable` reports whether a new sandbox can be reached yet; `waitUntilReady()` and the first runtime call now wait for it.
- Agents gain `keepalive()`, `rollback(snapshotId)`, preview ports (`exposePort` / `listPorts` / `revokePort` / `getUrl`), and an idle window: `idle_timeout_seconds` on create and update, read back as `agent.idleTimeoutSeconds`.
- `sandbox.files.upload(path, data)` sends a string, `Uint8Array`, `ArrayBuffer` or `Blob` in resumable chunks with progress; `files.write` uses it automatically above 1 MiB, so large writes no longer fail. In Node, `files.uploadFile(localPath, remotePath)` and `files.downloadFile(remotePath, localPath)` move files to and from the local disk without buffering them, and a failed download leaves no partial file.
- Errors: `APIError.code` is now the API's machine-readable code (`not_found`, `sandbox_quota_exceeded`, … — see the `ErrorCode` type), `APIError.scope` names the limit a quota refusal hit, and the message comes from the API's `message`. A `503` is a new `ServiceUnavailableError`, a subclass of `InternalServerError`.
- Sandbox templates carry an `icon`. `lastCrash` is cleared once a restore from a snapshot taken before the crash completes.
