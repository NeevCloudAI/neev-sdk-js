---
"@neevcloud/sdk": minor
---

Agent tools for frameworks: `tools.specs()` returns each enabled tool's `name`, `title`, `description`, `parameters` and a bound `call`, and `FatalGuard` stops a run on a sandbox call that throws (auth, rate limit, server, network) instead of letting the framework hand it to the model, answering the model with `{ error: FATAL_ERROR }`, running no further tools, and rethrowing the error to you through `raiseIfFailed()`. Three adapters ship as subpath exports, each framework an optional peer dependency: `@neevcloud/sdk/agent-tools/claude` (`toClaude`: an in-process MCP server with Claude Code's own tools off, plus `watch()` for the run), `@neevcloud/sdk/agent-tools/openai-agents` (`toOpenAIAgents`) and `@neevcloud/sdk/agent-tools/ai-sdk` (`toAiSdk`).
