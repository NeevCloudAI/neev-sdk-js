---
"@neevcloud/sdk": patch
---

`getPortUrl` / `getUrl` no longer wait out the whole timeout when the app itself answers 403 or 404 at its root, as an API-only or sign-in-gated server does. Those answers now count as routed; only a 403/404 from before the URL is routed keeps the wait going.
