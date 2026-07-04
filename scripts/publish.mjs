// Publish the package and point the npm dist-tags at it. While the SDK is
// pre-1.0 and ships only on the beta line, the newest build is the default
// install: every release publishes to "latest", and a prerelease is
// additionally tagged "beta" so the @beta channel keeps tracking the newest
// build. A plain stable version publishes to "latest" only.
// Revisit this once a stable 1.0 ships and prereleases should stop taking
// "latest".
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Read the name and version this build will publish from the package manifest.
const { name, version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// A version containing a hyphen (e.g. 0.6.1-beta) is a prerelease; the hyphen
// covers -beta, -alpha, -rc, etc.
const isPrerelease = version.includes("-");

// Publish under "latest" so `npm install @neevcloud/sdk` resolves to this
// build. Hand off to changesets via `pnpm exec` so the local `changeset`
// binary resolves regardless of how this script was invoked; changesets
// publishes every package with a pending release under the resolved tag, and
// stdio is inherited so npm/changeset output (and a non-zero exit) propagate.
console.log(`Publishing ${version} under dist-tag "latest"`);
execSync("pnpm exec changeset publish --tag latest", { stdio: "inherit" });

// Keep the @beta channel pointing at the newest build by also tagging a
// prerelease "beta". changeset publish sets a single tag, so add the second
// tag directly against the just-published version.
if (isPrerelease) {
  console.log(`Also tagging ${name}@${version} as "beta"`);
  execSync(`npm dist-tag add ${name}@${version} beta`, { stdio: "inherit" });
}
