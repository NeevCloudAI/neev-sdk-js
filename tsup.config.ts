import { defineConfig } from "tsup";

// Build the SDK as dual ESM + CommonJS with type declarations so it works in
// Node, Bun, Deno, and edge runtimes regardless of the consumer's module system.
// Splitting is on for CJS too, so every entry shares one copy of the error classes
// and instanceof holds across `@neevcloud/sdk` and its subpath exports.
export default defineConfig({
  entry: ["src/index.ts", "src/agent-tools.ts"],
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
