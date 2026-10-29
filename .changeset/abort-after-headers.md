---
"@neevcloud/sdk": patch
---

A caller's `AbortSignal` now also cancels a response body that is still streaming after the headers arrived (for example a buffered or streaming `exec`). Before, the signal was detached once headers arrived, so a stalled body could not be cancelled.
