import { defineConfig } from "vitest/config";

// @openai/agents needs Node 20 (its MCP client dependency is skipped on Node 18), so its adapter is tested from 20 up.
const openAIAgentsUnsupported = Number(process.versions.node.split(".")[0]) < 20;

// Test runner config. Coverage is measured against the runtime source only —
// the generated types, the type-only alias module, and the barrel are excluded.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: openAIAgentsUnsupported ? ["tests/agent-tools/openai-agents.test.ts"] : [],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/generated/**",
        "src/types.ts",
        "src/index.ts",
        ...(openAIAgentsUnsupported ? ["src/agent-tools/openai-agents.ts"] : []),
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
