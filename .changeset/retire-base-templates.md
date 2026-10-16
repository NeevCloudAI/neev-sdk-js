---
"@neevcloud/sdk": patch
---

Examples, docs and tests use `sb-ubuntu-26-04-dev` in place of the retired minimal, systemd and vnc templates, and the examples drop their workarounds for images without bash or python. New `examples/docker.ts` runs a container on the `sb-ubuntu-26-04-docker` template. The docs cover the template fields `interpreter` and `min_memory_gb`.
