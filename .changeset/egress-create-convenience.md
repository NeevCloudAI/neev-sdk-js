---
"@neevcloud/sdk": minor
---

Add `allowInternet` and `allowEgress` convenience options to `sandboxes.create` and `agents.create`. `allowInternet: true` opens all egress (it emits the `allow_internet` gate plus the `0.0.0.0/0` and `::/0` routes the server needs to actually open it); `allowEgress: ["github.com", "*.npmjs.org"]` allows specific hosts (FQDN or CIDR). Both translate to the `egress` policy; pass a full `egress` object for finer control (ports, protocols) and it takes precedence.
