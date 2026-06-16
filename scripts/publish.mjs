// Publish the package under the npm dist-tag implied by its version, so a
// prerelease never lands on "latest". A version containing a hyphen
// (e.g. 0.5.0-beta) is a prerelease and goes to the "beta" tag; a plain
// semver version (e.g. 0.5.0) is stable and goes to "latest".
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Read the version this build will publish from the package manifest.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// Map the version to its release channel. Any prerelease (the hyphen covers
// -beta, -alpha, -rc, etc.) is routed to the single "beta" tag; only a plain
// stable version publishes to "latest".
const tag = version.includes("-") ? "beta" : "latest";

// Hand off to changesets via `pnpm exec` so the local `changeset` binary
// resolves regardless of how this script was invoked. Changesets publishes
// every package with a pending release under the resolved tag; stdio is
// inherited so npm/changeset output (and a non-zero exit) propagate.
console.log(`Publishing ${version} under dist-tag "${tag}"`);
execSync(`pnpm exec changeset publish --tag ${tag}`, { stdio: "inherit" });
