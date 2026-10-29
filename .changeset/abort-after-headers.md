---
"@neevcloud/sdk": patch
---

A caller's `AbortSignal` now also cancels a response body that is still streaming after the headers arrived (for example a buffered or streaming `exec`). Before, the signal was detached once headers arrived, so a stalled body could not be cancelled. A body read cut short this way throws `APIConnectionError` ("Request aborted by caller"), except in `processes.follow` and `files.watch`, which end cleanly as documented. The listener is removed once the body is read, cancelled or fails, so reusing one signal across many requests does not accumulate listeners.
