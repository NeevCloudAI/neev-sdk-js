---
"@neevcloud/sdk": minor
---

Runtime calls (`exec`, `files`, `processes`, `code`, `pty`) on a `Paused` sandbox that still has a `connect_url` are now sent instead of failing with "call resume() first". Where the platform's automatic wake-up is enabled, the request wakes the sandbox and completes once it is ready. A paused sandbox with no `connect_url` still fails fast. New example: `examples/auto-resume.ts`.
