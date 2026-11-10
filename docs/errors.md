# Errors

Every failure the SDK throws is a `NeevError`, so you can branch on `instanceof` rather
than on message text.

- [Error classes](#error-classes)
- [Error codes](#error-codes)
- [Retrying](#retrying)

## Error classes

API failures are `APIError` subclasses, one per HTTP status. Each carries the status, a
machine-readable `code`, and a `requestId` to quote when you contact support.

```ts
import { APIError, NotFoundError } from "@neevcloud/sdk";

try {
  await neev.sandboxes.get("missing");
} catch (err) {
  if (err instanceof NotFoundError) {
    // handle a missing sandbox
  } else if (err instanceof APIError) {
    console.error(err.status, err.code, err.requestId);
  }
}
```

| Class | Status | When |
| --- | --- | --- |
| `NeevError` | | Base class of every SDK error. Thrown on its own by the SDK itself: before a request, such as for a missing API key or an empty update, or when a wait helper such as `waitUntilReady` gives up |
| `APIConnectionError` | | No HTTP response: DNS failure, connection reset, or your `signal` aborted |
| `APITimeoutError` | | The request ran past `timeoutMs`. A subclass of `APIConnectionError` |
| `APIError` | non-2xx | Base class for HTTP errors |
| `BadRequestError` | 400 | The request is malformed or failed validation |
| `AuthenticationError` | 401 | Missing, invalid or expired API key |
| `PermissionDeniedError` | 403 | Not allowed on this organization, project or resource |
| `NotFoundError` | 404 | No such resource |
| `ConflictError` | 409 | Conflicts with the current state, such as a name in use or a paused agent |
| `PreconditionFailedError` | 412 | A precondition failed |
| `TooEarlyError` | 425 | Not ready yet, such as an agent still provisioning; retry later |
| `RateLimitError` | 429 | Too many requests, or a paused sandbox that didn't wake |
| `InternalServerError` | Other 5xx | The server failed to handle a valid request |
| `ServiceUnavailableError` | 503 | Briefly unavailable; retry shortly. A subclass of `InternalServerError` |
| `DeadlineExceededError` | 504 | The operation ran past the server's deadline |

A non-zero exit from `exec`, and an exception in code run by `sandbox.code.run`, are
results, not errors: read `exitCode` or `run.error`.

## Error codes

`err.code` says why a call failed. Branch on it, not on the message, which may be
reworded at any time.

| Field on `APIError` | Meaning |
| --- | --- |
| `status` | The HTTP status |
| `code` | A machine-readable code, such as `not_found`, `validation_error` or `sandbox_quota_exceeded` |
| `reason` | Refines `code` where one code covers several cases, such as `context_busy` or `interpreter_not_enabled` from the code interpreter |
| `scope` | For a quota refusal, which limit was hit: `organization` or `project` |
| `details` | Extra detail from the response, when present |
| `requestId` | Include this when you contact support |

Codes from the API include `unauthorized`, `forbidden`, `not_found`, `validation_error`,
`bad_request`, `conflict`, `too_early`, `service_unavailable`, `internal_server_error`,
`sandbox_quota_exceeded` and `agent_quota_exceeded`; the `ErrorCode` type lists them all.

Errors from inside a sandbox (files, `exec`, processes) carry the sandbox's reason in
`code`, such as `not_found`, `invalid_argument`, `permission_denied`,
`failed_precondition`, `resource_exhausted` or `deadline_exceeded`, and map onto the
classes above.

```ts
import { APIError } from "@neevcloud/sdk";

try {
  await neev.sandboxes.create({ sandbox_template_id: "sb-ubuntu-26-04-dev" });
} catch (err) {
  if (err instanceof APIError && err.code === "sandbox_quota_exceeded") {
    console.error(`quota reached for this ${err.scope}`);
  } else {
    throw err;
  }
}
```

## Retrying

Lifecycle calls, such as `create`, `list` and `pause`, already retry network errors, 429
and 5xx up to `maxRetries` times (default 2) with backoff, honouring `Retry-After`. Calls
inside a sandbox, such as `exec` and `files.write`, are not retried, because running them
twice could repeat their effect.

When you retry yourself:

| Error | Do this |
| --- | --- |
| `TooEarlyError` | Wait a few seconds and retry; the resource isn't ready yet, such as forking an agent that is still provisioning |
| `ServiceUnavailableError` | Retry shortly |
| `RateLimitError` on a paused sandbox | Call `resume()` and retry; see [Pause and wake](./sandboxes.md#pause-and-wake) |
| `RateLimitError` with `code` `resource_exhausted` | The sandbox is at its limit of processes or in-flight requests: stop a process or retry shortly |
| `InternalServerError` with `status` 524 | The network cut a response that was silent for about 2 minutes; the command may still be running, so don't rerun it blindly |
| `APITimeoutError` | Raise `timeoutMs`, or check whether the work finished before you rerun it |
| `ConflictError` | Read the current state first; retrying unchanged repeats the conflict |
| `BadRequestError`, `AuthenticationError`, `PermissionDeniedError`, `NotFoundError` | Don't retry; fix the request or credentials |

Only retry a call inside a sandbox when running it twice is safe, such as a read or an
idempotent command.

```ts
import { TooEarlyError } from "@neevcloud/sdk";

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof TooEarlyError) || i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * i));
    }
  }
}

const copy = await withRetry(() => agent.fork("my-coder-copy"));
```
