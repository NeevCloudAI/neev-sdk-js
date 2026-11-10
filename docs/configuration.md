# Configuration

How `@neevcloud/sdk` authenticates, picks the organization and project to work in, and
talks to the API. The same client and options apply to every product.

- [Credentials](#credentials)
- [Organization and project scope](#organization-and-project-scope)
- [Client options](#client-options)
- [Timeouts and cancellation](#timeouts-and-cancellation)
- [Raw client](#raw-client)

## Credentials

The SDK authenticates with an API key, sent as a Bearer token. The same key covers
lifecycle calls (create, list, delete) and calls inside a sandbox (exec, files,
terminals). Create it in the [NeevCloud console](https://console.ai.neevcloud.com)
([how](https://docs.ai.neevcloud.com/getting-started/create-api-key)).

```sh
export NEEV_API_KEY="your-api-key"
```

```ts
import { Neev } from "@neevcloud/sdk";

const neev = new Neev(); // reads NEEV_API_KEY
const explicit = new Neev({ apiKey: process.env.MY_NEEV_KEY });
```

The constructor throws `NeevError` when neither `apiKey` nor `NEEV_API_KEY` is set. The
SDK does not load a `.env` file. It is a server-side SDK: never ship your API key to a
browser, and keep it out of source control and logs.

## Organization and project scope

Most calls act in one organization and project. Set the defaults on the client, or with
`NEEV_ORG_ID` and `NEEV_PROJECT_ID`. To find your IDs, see
[Organizations and projects](https://docs.ai.neevcloud.com/getting-started/org-and-project#find-your-organization-id-and-project-id).

```ts
const neev = new Neev({ orgId: "your-org-id", projectId: "your-project-id" });
```

Every sandbox and agent method also takes an `orgId` and `projectId` override for one
call. For `list`, `metrics`, `audit`, `listSnapshots`, `waitForSnapshot` and `exposePort`
it goes in the params object; every other method, including `create` and `update`, takes
it as a separate trailing scope argument, such as `create(params, { orgId, projectId })`. The template catalogues (`neev.templates`,
`neev.agentTemplates`) are not scoped to a project.

```ts
await neev.sandboxes.list({ orgId: "other-org", projectId: "other-project" });
await neev.sandboxes.get("web", { orgId: "other-org", projectId: "other-project" });
```

A handle remembers the scope it was fetched with, so its methods act in the same project.
A call with no organization or project set throws `NeevError` before any request is sent.

## Client options

Pass options to `new Neev({ ... })`, or set the matching environment variables.

| Option | Environment variable | Default |
| --- | --- | --- |
| `apiKey` | `NEEV_API_KEY` | Required |
| `orgId` | `NEEV_ORG_ID` | Required for most calls |
| `projectId` | `NEEV_PROJECT_ID` | Required for most calls |
| `baseURL` | `NEEV_BASE_URL` | `https://api.ai.neevcloud.com/agent` |
| `timeoutMs` | | `60000` |
| `maxRetries` | | `2` |
| `fetch` | | The runtime's `fetch` |
| `webSocket` | | The runtime's `WebSocket` |

Construct one client and reuse it; it holds no open connections, so there is nothing to
close.

**Runtimes.** The SDK runs on Node 18 and later, Bun, Deno and edge runtimes with a global
`fetch`. Pass `fetch` to use your own implementation, or on a runtime without one.
`sandbox.ssh()`, `files.uploadFile` and `files.downloadFile` need Node.

**WebSockets for terminals.** `sandbox.pty` needs a WebSocket that sends the API key
header, and a runtime's global `WebSocket` can't, so pass a factory on every runtime. In
Node, build it on [`ws`](https://www.npmjs.com/package/ws):

```ts
import { Neev } from "@neevcloud/sdk";
import WebSocket from "ws";

const neev = new Neev({ webSocket: (url, opts) => new WebSocket(url, opts) });
```

`sandbox.ssh()` uses the same factory when you set one, and otherwise loads `ws` itself.

## Timeouts and cancellation

`timeoutMs` bounds each attempt until the response starts. Calls whose response may
legitimately start late get extra time automatically: an `exec` gets its own `timeoutMs`
on top of the client's, and `processes.get(id, { wait: true })` gets the sandbox's wait
limit. A request that runs out of time
throws `APITimeoutError`.

Lifecycle calls retry network errors, 429 and 5xx up to `maxRetries` times with backoff,
honouring `Retry-After`. Calls inside a sandbox, such as `exec` and `files.write`, are not
retried, because running them twice could repeat their effect. The exception is a chunked
upload, which resumes from the last byte the sandbox received.

Calls inside a sandbox (`exec`, `files`, `code`, and `processes` except `kill` and
`killAll`, where `signal` is the signal number) take an `AbortSignal` as `signal`, and so
does `neev.raw.request`. Aborting it cancels the request,
including a response body that is still streaming, and throws `APIConnectionError`;
`processes.follow` and `files.watch` end cleanly instead.

```ts
const result = await sandbox.exec(["make", "test"], {
  timeoutMs: 600_000, // the command's own limit
  signal: AbortSignal.timeout(660_000),
});
```

Whatever the timeouts, the network in front of a sandbox cuts a response that sends
nothing for about 2 minutes. The call then fails with `InternalServerError` (status 524)
or a dropped stream, and the command may still be running. Run quiet or long work with
`sandbox.processes.start(...)`, or stream it with `exec(..., { stream: true })` if it
prints as it goes; see [Commands and processes](./sandboxes.md#commands-and-processes).

Waiting helpers take their own timing: `waitUntilReady({ timeoutMs, pollIntervalMs })`
(default 2 minutes), `waitForSnapshot` (5 minutes) and `getUrl` (1 minute).

## Raw client

For an endpoint the SDK does not wrap yet, `neev.raw.request<T>()` sends a request with
the same authentication, timeout, retries and typed errors.

```ts
const widget = await neev.raw.request<{ id: string }>({
  method: "GET",
  path: "/api/v1beta1/orgs/your-org-id/projects/your-project-id/widgets/123",
  query: { limit: 10 },
});
```

`path` is relative to `baseURL`; `query` entries that are `null` or `undefined` are left
out, and `body` is sent as JSON. An empty response resolves to `undefined`.
