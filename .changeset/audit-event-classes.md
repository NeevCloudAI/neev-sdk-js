---
"@neevcloud/sdk": minor
---

The audit trail now records every program a sandbox runs and every connection those programs open, not only the calls made to it. `audit()` returns three OCSF event classes in `data`: API Activity (`class_uid` 6003) for a call, Process Activity (1007) for a program starting or ending, and Network Activity (4001) for a connection. A program event carries `process` (`pid`, `name`, `file.path`, `working_directory`, `parent_process.pid`) and, when it ends, `exit_code` or a `status_detail` such as `signal 9`; a connection carries `actor.process` and `dst_endpoint`. New types: `AuditProcess`, `AuditFile`, `AuditDstEndpoint`, `AuditDevice`.

`api` and `resources` are present on API Activity only, so read `e.api?.operation`. `actor.user.type` is now the OCSF caption (`"User"`, `"API Key"`, `"System"`, `"Unknown"`), and an API key is in `actor.user.programmatic_credentials[].uid` instead of `credential_uid`. The `actorType` filter still takes `"user"`, `"api_key"` and `"system"`.

`sandboxes.update(id, { execution_trace: false })` and `sandbox.update({ execution_trace: false })` stop recording programs and connections without a restart; `true` turns it back on. `sandbox.executionTrace` reports the current setting.
