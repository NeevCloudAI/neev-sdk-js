---
"@neevcloud/sdk": minor
---

Agent tools: `@neevcloud/sdk/agent-tools` exports `SandboxTools`, `DESCRIPTIONS` and `PARAMETERS`, the NeevCloud sandbox tool contract for agents built on any framework. `new SandboxTools(sandbox, { allowPreview, allowRollback, allowProcesses })` binds `runCommand`, `writeFile` and `readFile`, plus the opt-in `exposePort`, `checkpoint`/`rollback`, and `startProcess`/`readProcessOutput`/`stopProcess`; `names()` lists the enabled tools in contract order, and `call(name, args)` runs a model's tool call by name. Each tool takes the model's snake_case arguments and resolves to a plain result, with `{ error }` for failures the model can fix. `call()` never throws for model input: an unknown tool, a disabled tool, or arguments that do not fit `PARAMETERS` resolve to an error result. `readProcessOutput` takes an optional `wait_s` (0–60 s) to wait for a running process to exit before reading. `runCommand` turns the network edge's 524, for a command silent for about 2 minutes, into an error result that points the model at `start_process`. Argument and result types are exported for every tool.

`DESCRIPTIONS`, `PARAMETERS` and every error result read exactly as the Python SDK's: an API error becomes `HTTP <status> <code>: <message>` (or `HTTP <status>: <message>` without a code), built from the error's fields so the request id never reaches the model, and a file that is not UTF-8 reads `not UTF-8 text`.

API errors: lifecycle and sandbox calls now read an error body the same way, by its content whatever the `Content-Type`. A JSON object keeps its fields, with sandboxd's `reason_code` as the `code` when there is no `code`; anything else (an HTML page, plain text, invalid JSON, or JSON such as `[1,2]`, `"oops"` or `null`) is kept as the error's `details`; and body fields that are not strings (such as `{"code": 5}`) are ignored.

`exec` output, `processes.follow` output and `files.readText` keep a leading byte order mark (U+FEFF); it was dropped before.

An `exec` with a `timeoutMs` longer than the client's `timeoutMs`, and a blocking `processes.get(id, { wait: true })`, no longer fail with `APITimeoutError` at the client timeout: the sandbox starts those responses only when the command ends or the process exits, so their per-request timeout now extends by the exec's `timeoutMs` and by the sandbox's 5-minute wait ceiling. The network edge in front of the sandbox still cuts off a response that stays silent for about 2 minutes, so long quiet work belongs in `sandbox.processes`.
