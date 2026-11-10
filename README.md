# NeevCloud SDK for TypeScript

The official TypeScript client for NeevCloud, published as `@neevcloud/sdk`.

[![npm](https://img.shields.io/npm/v/@neevcloud/sdk)](https://www.npmjs.com/package/@neevcloud/sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![CI](https://github.com/NeevCloudAI/neev-sdk-js/actions/workflows/ci.yml/badge.svg)](https://github.com/NeevCloudAI/neev-sdk-js/actions/workflows/ci.yml)

One package for the NeevCloud products you build with: Sandboxes, Agents and Agent tools
today, with more to come. It runs on Node, Bun, Deno and edge runtimes, with one client,
one API key, and typed requests, responses and errors.

> **AI agents:** before writing code with `@neevcloud/sdk`, read
> [`docs/ai-agents.md`](./docs/ai-agents.md)
> ([raw](https://raw.githubusercontent.com/NeevCloudAI/neev-sdk-js/main/docs/ai-agents.md)).
> It has the pre-flight checks, the rules to follow, and a recipe per product.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Products](#products)
- [Documentation](#documentation)
- [Examples](#examples)
- [Security](#security)
- [License](#license)

## Install

```sh
npm install @neevcloud/sdk
# or
pnpm add @neevcloud/sdk
bun add @neevcloud/sdk
```

Runs on Node 18+, Bun, Deno and edge runtimes with a global `fetch`. It is a
server-side SDK: never ship your API key to a browser.

## Quick start

Set your credentials:

```sh
export NEEV_API_KEY="your-api-key"
export NEEV_ORG_ID="your-org-id"
export NEEV_PROJECT_ID="your-project-id"
```

Find your organization and project IDs as described in [Organizations and projects](https://docs.ai.neevcloud.com/getting-started/org-and-project#find-your-organization-id-and-project-id).

Create a sandbox, run a command, read a file, and clean up:

```ts
import { Neev } from "@neevcloud/sdk";

const neev = new Neev(); // reads the NEEV_* variables

const sandbox = await neev.sandboxes.create({ sandbox_template_id: "sb-ubuntu-26-04-dev" });

try {
  await sandbox.waitUntilReady();
  const { stdout } = await sandbox.exec(["python3", "-c", "print(6 * 7)"]);
  console.log(stdout); // 42

  await sandbox.files.write("hello.txt", "hello from NeevCloud\n");
  console.log(await sandbox.files.readText("hello.txt"));
} finally {
  await sandbox.delete();
}
```

New to NeevCloud? [Getting started](./docs/getting-started.md) walks through each step.

## Products

| Product | What it is | Entry point | Guide |
| --- | --- | --- | --- |
| Sandboxes | Isolated machines that run your code, commands and servers | `neev.sandboxes`, `neev.templates` | [Sandboxes](./docs/sandboxes.md) |
| Agents | Ready-made coding agents, such as Claude Code, each on its own sandbox | `neev.agents`, `neev.agentTemplates` | [Agents](./docs/agents.md) |
| Agent tools | A sandbox tool set, with model-ready schemas, for the agent you build | `@neevcloud/sdk/agent-tools` | [Agent tools](./docs/agent-tools.md) |

**What you can do with a sandbox:** run commands and background processes, move files of
any size, run Python in a stateful code interpreter, open a terminal or an SSH tunnel,
serve an app at a public preview URL, control which hosts it can reach, snapshot, fork and
roll back, label it, read its audit trail, and pause it and wake it on use. The
[Sandboxes guide](./docs/sandboxes.md) covers each one.

## Documentation

| Guide | What you'll find |
| --- | --- |
| [Getting started](./docs/getting-started.md) | Install, credentials and a first sandbox, step by step |
| [Sandboxes](./docs/sandboxes.md) · [Agents](./docs/agents.md) · [Agent tools](./docs/agent-tools.md) | One guide per product |
| [Configuration](./docs/configuration.md) | Credentials, organization and project scope, client options, timeouts and the raw client |
| [Errors](./docs/errors.md) | Error classes, error codes and when to retry |
| [API reference](./docs/api-reference.md) | Every method, grouped by product, with snippets |
| [API inventory](./docs/api-inventory.md) | Full signatures, types and errors |
| [Use from an AI agent](./docs/ai-agents.md) | Prompts to paste into Claude Code, Cursor or Codex, and the rules they follow |
| [Changelog](./CHANGELOG.md) | What changed in each release |

The full NeevCloud documentation is at <https://docs.ai.neevcloud.com>. Questions and
bugs: [open an issue](https://github.com/NeevCloudAI/neev-sdk-js/issues).

## Examples

[`examples/`](./examples) has runnable scripts for sandboxes, agents and agent tools, and
[`examples/agents/`](./examples/agents/README.md) wires a sandbox into LangChain, Genkit
and the Vercel AI SDK. Each one cleans up after itself; see the
[examples README](./examples/README.md) for setup and the full list.

## Security

To report a vulnerability, see [SECURITY.md](./SECURITY.md). Please don't open a public
issue for it. Keep your API key out of source control and logs. Contributions are
welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE) © NeevCloud
