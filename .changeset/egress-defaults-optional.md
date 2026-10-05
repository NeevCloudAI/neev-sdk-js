---
"@neevcloud/sdk": patch
---

Request fields the API gives a default are optional in the types again. An egress policy no longer has to spell out `allow_internet` (it defaults to `false`) or `mode`, so `create({ egress: { mode: "allow_list", allow: [...] } })` and the same `update()` call type-check as written. Reading `sandbox.egress.mode` or `allow_internet` from a response is now typed as possibly undefined, matching the API description.
