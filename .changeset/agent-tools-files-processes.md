---
"@neevcloud/sdk": minor
---

Agent tools: `stat_path`, `move_path` and `delete_path` join the default tools (`statPath`, `movePath`, `deletePath`), and `list_processes` (`listProcesses`) joins the `allowProcesses` tools so the model can find a `process_id` it no longer has. `stat_path` answers `{ exists: false }` for a missing path; `delete_path` needs `recursive: true` for a non-empty directory, and its `recursive` must be a JSON boolean. `read_file` takes optional `offset` and `length` (up to 10000 bytes) to read a large file in pages, returning `next_offset` and `eof`, with each page trimmed to whole UTF-8 characters. A new `TITLES` export gives each tool a short display title, and `DESCRIPTIONS`, `PARAMETERS` and `TITLES` stay identical to the Python SDK's.

`files.read` and `files.readText` take `offset` and `length` to return only a byte range; the download stops as soon as the range has arrived.
