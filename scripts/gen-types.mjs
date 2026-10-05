// Generates TypeScript types for every vendored OpenAPI spec.
//
// Each `specs/<service>.yaml` produces `src/generated/<service>.ts` via
// openapi-typescript. Specs are migrated into `specs/` from the backend services
// one at a time; dropping a new file here and re-running `pnpm gen` is all that
// is needed to make a service's types available for a hand-written wrapper.
//
// Usage: node scripts/gen-types.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";

const SPECS_DIR = "specs";
const OUT_DIR = "src/generated";

// Collects every YAML spec file in the specs directory.
function specFiles() {
  return readdirSync(SPECS_DIR)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();
}

// Runs openapi-typescript for one spec, writing src/generated/<service>.ts.
function generate(specFile) {
  const service = specFile.replace(/\.(ya?ml)$/, "");
  const input = `${SPECS_DIR}/${specFile}`;
  const output = `${OUT_DIR}/${service}.ts`;
  console.log(`openapi-typescript ${input} -> ${output}`);
  // `shell` is needed on Windows so the pnpm.cmd shim resolves via execFileSync.
  // A field with a default stays optional, so callers can omit it as the API allows.
  const args = ["exec", "openapi-typescript", input, "-o", output, "--default-non-nullable=false"];
  execFileSync("pnpm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

mkdirSync(OUT_DIR, { recursive: true });
const specs = specFiles();
if (specs.length === 0) {
  console.warn(`No specs found in ${SPECS_DIR}/`);
}
for (const spec of specs) {
  generate(spec);
}
