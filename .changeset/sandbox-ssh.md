---
"@neevcloud/sdk": minor
---

Add SSH tunnelling for sandboxes. `sandbox.ssh()` opens a local loopback TCP listener that forwards each connection to the sandbox over an authenticated WebSocket and returns `{ host, port, close }`, so any ssh client, `scp`/`rsync`, or IDE remote-dev points at it with no keys to manage and no public port. Node only; install the optional `ws` peer dependency, which the tunnel loads automatically.
