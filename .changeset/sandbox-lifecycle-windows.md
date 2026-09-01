---
"@neevcloud/sdk": minor
---

Add sandbox lifecycle windows and surface create-time options. New `sandboxes.keepalive(id)` (resets the idle timer) and `sandboxes.updateTimeout(id, windows)` (changes idle/lifetime windows in place), plus the matching `sandbox.keepalive()` and `sandbox.updateTimeout(windows)` handle methods. `create()` now documents and supports `lifecycle` (idle/lifetime windows) — omitting it sends no `lifecycle` key so account defaults apply — and BYOI `image` / `command`.

Windows are in seconds (`idle_timeout_seconds`, `max_lifetime_seconds`, `paused_retention_seconds`, `on_idle`), passed through unchanged: send `0` to turn a window off (no limit), an omitted field is left unchanged. An out-of-enum `on_idle` (anything but `"pause"`/`"delete"`) throws `NeevError` before the request is sent. Adds exported types `OnIdleAction`, `SandboxLifecycle`, and `UpdateTimeoutParams`.
