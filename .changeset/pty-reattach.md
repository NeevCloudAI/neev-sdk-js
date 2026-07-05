---
"@neevcloud/sdk": minor
---

Add PTY reattach. `PtyHandle` now exposes the terminal `id`, and `sandbox.pty.create({ id })` reconnects to an existing terminal after a dropped connection — the sandbox replays recent scrollback and the session keeps running while detached.
