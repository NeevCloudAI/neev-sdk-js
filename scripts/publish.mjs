// Publish the package and point the npm dist-tags at it. Authentication is npm
// trusted publishing: the workflow's OIDC identity is exchanged for a
// short-lived token by the npm CLI itself, so there is no NPM_TOKEN to expire
// and no 2FA prompt for CI to answer.
//
// This calls `npm publish` directly rather than `changeset publish`. Changesets
// delegates to `pnpm publish` whenever a pnpm lockfile is present, and pnpm has
// no OIDC support — the token exchange only happens inside the npm CLI. For a
// single-package repo the only thing changesets adds here is a "skip what is
// already on the registry" check, which is the guard below.
//
// While the SDK is pre-1.0 and ships only on the beta line, the newest build is
// the default install: every release publishes to "latest", and a prerelease is
// additionally tagged "beta" so the @beta channel keeps tracking the newest
// build. A plain stable version publishes to "latest" only.
// Revisit this once a stable 1.0 ships and prereleases should stop taking
// "latest".
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Read the name and version this build will publish from the package manifest.
const { name, version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// A version containing a hyphen (e.g. 0.6.1-beta) is a prerelease; the hyphen
// covers -beta, -alpha, -rc, etc.
const isPrerelease = version.includes("-");

// `npm view <pkg>@<version>` exits non-zero when that exact version is not on
// the registry. Treat a hit as "already done" so re-running a release that
// failed after the publish (a dist-tag step, say) is a no-op instead of an
// EPUBLISHCONFLICT.
function isAlreadyPublished() {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

if (isAlreadyPublished()) {
  console.log(`${name}@${version} is already on the registry; skipping publish`);
} else {
  // Publish under "latest" so `npm install @neevcloud/sdk` resolves to this
  // build. Provenance comes from publishConfig.provenance in package.json and is
  // signed with the same OIDC identity.
  console.log(`Publishing ${version} under dist-tag "latest"`);
  execFileSync("npm", ["publish", "--tag", "latest"], { stdio: "inherit" });
}

// Keep the @beta channel pointing at the newest build by also tagging a
// prerelease "beta". A publish sets a single tag, so add the second one
// directly against the just-published version.
//
// `npm dist-tag` does not do the OIDC exchange that `npm publish` does, so this
// can fail even though the publish succeeded. The package is already on the
// registry at that point and a missing secondary tag is trivially fixable, so
// report it and exit clean rather than failing a release that actually shipped.
if (isPrerelease) {
  console.log(`Also tagging ${name}@${version} as "beta"`);
  try {
    execFileSync("npm", ["dist-tag", "add", `${name}@${version}`, "beta"], { stdio: "inherit" });
  } catch {
    console.warn(
      `\nWARNING: ${name}@${version} published, but the "beta" dist-tag was not set.
The @beta channel still points at the previous prerelease. To fix it, run:
  npm dist-tag add ${name}@${version} beta\n`,
    );
  }
}
