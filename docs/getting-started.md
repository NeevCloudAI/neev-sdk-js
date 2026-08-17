# @neevcloud/sdk — Getting Started

Install the SDK, configure credentials, and run your first script. For a shorter
overview, see the [README](../README.md). When you need API lists, method
signatures, or example references, use the [documentation map](#documentation-map)
below.

`@neevcloud/sdk` is **async-only**: every method returns a `Promise`, so all the
snippets below use `await` (inside an `async` function or a module that supports
top-level `await`).

## Prerequisites

Before installing, confirm you have:

- **Node.js ≥ 18** (`node --version`). The SDK needs a server-side runtime with a
  global `fetch` — Node 18+, **Bun**, **Deno**, or an edge runtime all work.
- A supported OS: **Windows**, **macOS**, or **Linux**.
- A NeevCloud API key and your org/project ids (from your NeevCloud account).

There is **no browser build** — your API key must never ship to a browser.

The package has a single runtime dependency (`openapi-fetch`) for HTTP transport;
it is installed automatically with the SDK.

## Installation

The SDK is currently published as a **beta**. Install it with your package
manager of choice — these docs use **pnpm**:

```sh
pnpm add @neevcloud/sdk@beta
# or: npm install @neevcloud/sdk@beta · yarn add @neevcloud/sdk@beta · bun add @neevcloud/sdk@beta
```

Once the package leaves beta, drop the `@beta` tag to track the latest stable
release.

To run the bundled examples from a clone instead, see
[`examples/README.md`](../examples/README.md) — `import "@neevcloud/sdk"` resolves
to the local build via Node package self-referencing (no link step), and each
example runs with `npx tsx examples/<file>.ts`.

## Configure credentials

The client reads configuration from explicit constructor options **or** `NEEV_*`
environment variables. Set the environment variables before running a script, or
pass the equivalent options to `new Neev({ ... })`.

| Variable | Option | Purpose |
| -------- | ------ | ------- |
| `NEEV_API_KEY` | `apiKey` | Bearer token (**required**) |
| `NEEV_ORG_ID` | `orgId` | Default organization id |
| `NEEV_PROJECT_ID` | `projectId` | Default project id |

Notes:

- `apiKey` is required; the constructor throws if it is neither passed nor set via
  `NEEV_API_KEY`.
- `orgId` / `projectId` are required to make a call, but may be set on the client
  **or** overridden per call (see [per-call scope](#per-call-scope-override)).

**Linux / macOS (bash/zsh)** — current session:

```sh
export NEEV_API_KEY="your-api-key"
export NEEV_ORG_ID="org-abc123"
export NEEV_PROJECT_ID="proj-xyz789"
```

**Windows PowerShell** — current session:

```powershell
$env:NEEV_API_KEY = "your-api-key"
$env:NEEV_ORG_ID = "org-abc123"
$env:NEEV_PROJECT_ID = "proj-xyz789"
```

**Persistence:** The commands above apply only to the current terminal session.
To keep credentials across restarts, set them as user-level environment variables
in your OS settings (Windows System Properties → Environment Variables, or your
shell profile / secrets manager on macOS/Linux). The SDK does not load a `.env`
file automatically.

Equivalently, configure the client in code instead of the environment:

```ts
import { Neev } from "@neevcloud/sdk";

const neev = new Neev({
  apiKey: process.env.NEEV_API_KEY,
  orgId: process.env.NEEV_ORG_ID,
  projectId: process.env.NEEV_PROJECT_ID,
});
```

You can also tune transport behavior via `timeoutMs` (per-request timeout,
default `60000`) and `maxRetries` (transient-failure retries, default `2`).

## Imports

```ts
import { Neev, Sandbox, NeevError, NotFoundError, APIError } from "@neevcloud/sdk";
import type {
  CreateSandboxParams,
  SandboxData,
  SandboxPhase,
  ExecResult,
  ExecStreamEvent,
  FileEntry,
} from "@neevcloud/sdk";
```

The package re-exports the `Neev` client, the `Sandbox` handle, the runtime
files/exec types, the lifecycle resource types, and the full typed error
hierarchy (`NeevError` and its subclasses such as `NotFoundError`,
`AuthenticationError`, `RateLimitError`, `APIError`). All public symbols come from
the single top-level `@neevcloud/sdk` entry point.

## From zero to your first sandbox

This section walks the full path from a clean project to a running sandbox.

1. **Install the SDK** into a Node 18+ project:

   ```sh
   pnpm add @neevcloud/sdk@beta
   ```

2. **Set credentials** using the [blocks above](#configure-credentials). At
   minimum you need `NEEV_API_KEY`, `NEEV_ORG_ID`, and `NEEV_PROJECT_ID`.

3. **Construct the client.** With the env vars set, no arguments are needed:

   ```ts
   import { Neev } from "@neevcloud/sdk";

   const neev = new Neev();
   ```

4. **Create your first sandbox.** Every field is optional — the platform generates
   a name and defaults the template when you omit them. (Pass `name` to label it,
   or `sandbox_template_id` to pin a template.)

   ```ts
   const sandbox = await neev.sandboxes.create({});
   console.log(`created ${sandbox.id} (phase: ${sandbox.phase})`);
   ```

   > **Resources.** When you omit `resources` (or any field), the platform assigns
   > 1 vCPU / 2 GB memory / 10 GB disk. Valid ranges are cpu 0.5–8 (step 0.5),
   > memory 1–16 GB, disk 10–100 GB (step 10). See
   > [`SandboxResources`](./api-inventory.md#sandboxresources). Agents created from a
   > template inherit that template's sizing instead — see
   > [Agent resources](./api-inventory.md#agent-resources).

5. **Wait until it is Ready**, then work inside it:

   ```ts
   await sandbox.waitUntilReady();
   console.log(`ready at ${sandbox.connectUrl}`);
   ```

6. **Pause and clean up** when you are done (see the full script in
   [Quick start](#quick-start)).

If you see authentication or permission errors, double-check your API key and
org/project ids. `create` returns a funds-validation error when the project has no
available credits.

## Quick start

This walkthrough creates a sandbox, waits for it to become Ready, runs a command,
writes and reads a file, pauses the sandbox, then deletes it. Save it as
`quickstart.ts` and run it with [tsx](https://github.com/privatenumber/tsx):

```sh
npx tsx quickstart.ts
```

```ts
import { Neev } from "@neevcloud/sdk";

// Reads NEEV_API_KEY / NEEV_ORG_ID / NEEV_PROJECT_ID from the environment.
const neev = new Neev();

async function main(): Promise<void> {
  // 1. Create a sandbox. Every field is optional — the platform generates a
  //    name and defaults the template.
  const sandbox = await neev.sandboxes.create({});
  console.log(`created ${sandbox.id} (phase: ${sandbox.phase})`);

  try {
    // 2. Poll until the sandbox is Ready and reachable.
    await sandbox.waitUntilReady();
    console.log(`ready at ${sandbox.connectUrl}`);

    // 3. Run a buffered command. A non-zero exitCode is returned, not thrown.
    const result = await sandbox.exec(["sh", "-c", "echo hello from sandbox"]);
    console.log(`stdout=${result.stdout.trim()} exitCode=${result.exitCode}`);

    // 4. Write and read a file. Paths are workspace-relative — the sandbox
    //    rejects absolute paths.
    const { bytesWritten } = await sandbox.files.write("notes.txt", "written by the SDK\n");
    console.log(`wrote ${bytesWritten} bytes`);
    const text = await sandbox.files.readText("notes.txt");
    console.log(`file contents: ${text.trim()}`);

    // 5. Pause to release compute (scales to zero replicas).
    await sandbox.pause();
    console.log(`paused (replicas: ${sandbox.replicas})`);
  } finally {
    // 6. Delete to clean up.
    await sandbox.delete();
    console.log("deleted");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

Key points:

- Use `sandbox_template_id` (not `template_id`) in `create` params when you want a
  specific template; omit it to use the platform default.
- Egress is **deny-all** by default. Pass `allowInternet: true` to open all outbound
  network, or `allowEgress: ["github.com", "*.npmjs.org"]` for specific hosts. The same
  fields work on `agents.create`.
- `connectUrl` is a getter on the handle; it is populated once the sandbox is
  Ready.
- Always `await sandbox.waitUntilReady()` before `exec` or `files` operations. The
  handle will also wait automatically on the first runtime call if you skip it.
- `pause()` and `resume()` return the updated `Sandbox` handle; `delete()`
  resolves to `void`.
- File and `exec` calls are **not** retried automatically (a retried write could
  run twice).

### Streaming output

For long-running commands or live logs, pass `{ stream: true }`. `exec` then
returns an async iterable of `stdout`/`stderr` chunks followed by a terminal
`exit` event:

```ts
for await (const event of sandbox.exec(["sh", "-c", "seq 1 3"], { stream: true })) {
  if (event.type === "stdout") process.stdout.write(event.data);
  else if (event.type === "stderr") process.stderr.write(event.data);
  else console.log(`exit ${event.exitCode}`); // non-zero reported here, not thrown
}
```

### Per-call scope override

Any method accepts an optional scope to target a different org/project than the
client default:

```ts
await neev.sandboxes.list({ orgId: "other-org", projectId: "other-proj" });
```

### Error handling

Every failure is a typed `NeevError` subclass:

```ts
import { NotFoundError, APIError } from "@neevcloud/sdk";

try {
  await neev.sandboxes.get("missing");
} catch (err) {
  if (err instanceof NotFoundError) {
    // 404 — handle a missing sandbox
  } else if (err instanceof APIError) {
    console.error(err.status, err.code, err.requestId);
  }
}
```

For snapshot capture, restore, and fork workflows, see
[`examples/snapshot-fork-restore.ts`](../examples/snapshot-fork-restore.ts) and
the snapshots section of [`api-reference.md`](./api-reference.md).

## Documentation map

| Document | What you'll find |
| -------- | ---------------- |
| [README](../README.md) | Short install overview, quickstart, usage snippets |
| **Getting started** (this file) | Full install walkthrough, env vars, first script |
| [`api-reference.md`](./api-reference.md) | Lifecycle vs runtime API lists and copy-paste snippets |
| [`api-inventory.md`](./api-inventory.md) | Full method signatures, parameter tables, types, errors |
| [`examples/README.md`](../examples/README.md) | Tiered learning path and per-example run commands |
