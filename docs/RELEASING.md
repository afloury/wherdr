# Releasing wherdr

Publishing a version requires the user's explicit approval. Never republish a package held
for npm review. No new secret is needed: GitHub uses `GITHUB_TOKEN`, npm uses OIDC Trusted
Publishing (`npm.yml`), and the tap uses the existing optional `HOMEBREW_TAP_TOKEN`.

1. Merge reviewed changes, including the release workflows, into `main`. The site workflow
   deploys relevant changes on pushes to `main`, independently of tags and npm.
2. Set the same version in `package.json`, `package-lock.json` and `herdr-plugin.toml`.
   Move the Unreleased changelog into a dated version entry. Run tests, typecheck and leak
   checks; review and merge this version commit before tagging it.
3. Create the GitHub release as a **draft**, with reviewed English notes under one or more of New / Improved /
   Fixed / Update. Write at least two readable sentences explaining what changed for users,
   then link to the tagged CHANGELOG.md (see the example below). A link alone, including
   "See CHANGELOG.md", is never sufficient. Push its version tag only after these notes are ready.
   The workflow validates the draft before attaching the package and again immediately before
   publication; missing or insufficient notes fail the job. It never generates stable release notes.
4. The tag starts `release.yml` and `npm.yml` independently. `release.yml` builds a multiarch
   Docker image and runs `npm pack` (prepack builds Nitro, includes `skills/wherdr`, resolves
   linked packages). It attaches `wherdr-X.Y.Z.tgz` and `wherdr-X.Y.Z.tgz.sha256` to the draft.
   After both jobs succeed, it publishes the release with `latest=false`. Docker and the
   public GitHub package are now usable; native plugins compare the archive checksum. A failed
   image or package job leaves the release draft; fix and rerun the failed jobs.
5. The Homebrew job updates the formula URL and SHA from GitHub, without waiting for npm.
   **The manual Homebrew step is MANDATORY while `HOMEBREW_TAP_TOKEN` is absent** (including
   the current 1.3.3 preparation). Wait for `release.yml` to finish successfully first, so its
   archive is public; then run `scripts/bump-homebrew.sh`. Otherwise the legacy update channel
   cannot advance even when npm is ready. A skipped Homebrew job does not complete this step.
   Homebrew still uses npm to install the local archive and fetch its third-party dependency;
   it does not need the new **wherdr version** to be available on npm.
6. `npm.yml` waits for the attached archive (up to 30 minutes), verifies it, then publishes
   that exact file with provenance. npm moderation may still delay registry availability.
   If the assets were too slow to arrive, rerun the failed download job before any successful
   publication; never retry a successful `npm publish` merely because moderation is pending.
   To recover a workflow fix without moving a tag, run `gh workflow run npm.yml --ref main -f version=vX.Y.Z` after merging the fix; it checks out that tag and publishes its existing release archive.
7. `release-ready.yml` checks hourly and after npm/release workflow completion. Once npm's
   tarball and `latest` tag, and the Homebrew formula are ready, it marks the GitHub release
   `latest`. Existing 1.3.x apps read this marker and can then safely use their npm updater.
   New apps read published stable releases directly, checking npm or the formula for their
   own installation mode. No update notice is offered while that channel is unavailable.

An old plugin can get the release immediately via **U** in Herdr or the one-command installer;
its old in-app Update button waits for the legacy channel. Plugin installation tries the exact
version from GitHub, then npm, then compiles only when neither prebuilt source works. This
includes older releases with no GitHub archive. Keep the previous npm version, GitHub assets,
and Homebrew keg available for automatic health-check rollback.

SHA-256 checks download integrity, not authenticity: the archive and checksum share an origin.
Replacing both defeats this check. npm fallback compares the archive to the SHA-512 integrity
in registry metadata, with the same limitation. There is no signature or build attestation check.

npm provenance identifies the publishing workflow (`npm.yml`); the archive was built by
`release.yml` in the same repository at the requested tagged commit. On a manual run from
`main`, provenance identifies the workflow's `main` commit, while checkout and version checks
use the requested tag. It does not independently attest that separate build workflow (M8);
this limitation is intentionally retained.

Readiness logs name each missing npm or Homebrew condition, and an already-current `latest`
marker is left alone. GitHub disables scheduled workflows in public repositories after 60 days
without repository activity. Check that `release-ready.yml` remains enabled; re-enable it and
run it manually if needed. After re-enabling, workflow-completion and manual checks work too.

## Release notes checklist

- Summarize the changes in English under `## New`, `## Improved`, `## Fixed` or `## Update`;
  omit categories with no relevant changes. Use complete sentences, at least two in total
  (at least twelve words), describing the user-visible behavior and any required upgrade action.
- Put the full changelog link after the summary, using the release tag rather than `main`.
- Review the text against that version's changelog. The automated check enforces structure
  and minimum content; the reviewer checks accuracy and clarity.
- Validate the exact draft text locally before pushing the tag:
  `GITHUB_REPOSITORY=example/wherdr GITHUB_REF_NAME=vX.Y.Z node scripts/check-release-notes.mjs < /tmp/wherdr-X.Y.Z.md`.
  If the workflow refuses the notes, edit the draft and rerun the failed jobs.

Example (replace `example/wherdr` and the version, and describe the actual release):

```markdown
## Improved
File downloads now work with the supported Node versions. Temporary download links
are released after the browser saves the file, keeping repeated downloads reliable.

[Full changelog](https://github.com/example/wherdr/blob/vX.Y.Z/CHANGELOG.md)
```

## Rolling v2 prerelease

`v2-prerelease.yml` rebuilds one prerelease on every push to the `v2` branch, so a machine
can install v2 from a prebuilt package (the plugin's GitHub download) and never compile it.
It publishes the version of `herdr-plugin.toml` (today `2.0.0-dev`) as `v<version>`:

- the tag moves to the pushed commit; the release is a prerelease, never `latest`. The update
  checks of every version, the legacy channel and `release-ready.yml` only read stable
  `vX.Y.Z` releases, so none of them offers it;
- `wherdr-<version>.tgz` and `.tgz.sha256` are made as in `release.yml` (`npm pack`,
  `sha256sum`) and replaced; the archive must hold the built server, `bin` with
  `bin/lib/install-skill.sh`, `package.json` and `skills/wherdr/SKILL.md`, and no native code
  (`.node`, `binding.gyp`, `prebuilds`, ELF or Mach-O files): the same file runs on
  linux-arm64 and x64;
- `COMMIT` holds the full SHA of the packaged commit, also written in the notes. It is removed
  before the archive is replaced and attached last: when `COMMIT` is there and names the
  branch head, the archive is that commit's.

The rolling notes start with an Update summary of the first three top-level Unreleased
changelog entries and a link to the changelog at the packaged commit, followed by build
metadata. Keep these entries readable and current; packaging fails if they are absent or fail the same minimum-content check.

`scripts/prerelease.sh` does the checks and the publication. It refuses a version without a
prerelease suffix (`X.Y.Z-something`) and a release of that tag that is not a published
prerelease: stable versions keep going through the steps above. The tag is moved with
`GITHUB_TOKEN`, which starts neither `release.yml` nor `npm.yml`. The workflow runs from the
`v2` branch: it acts once this file is on `v2`.

## Commands for 1.3.3

Run in a release checkout after explicit approval. These commands are documentation, not a
request to publish. The version commit must go through the usual reviewed PR process.

```sh
git switch main
git pull --ff-only
git switch -c release/1.3.3
npm version 1.3.3 --no-git-tag-version
sed -i.bak 's/^version = ".*"/version = "1.3.3"/' herdr-plugin.toml
rm herdr-plugin.toml.bak
# Move Unreleased notes to the dated 1.3.3 entry, run the project checks, then commit.
git add package.json package-lock.json herdr-plugin.toml CHANGELOG.md
git commit -m "Prepare release 1.3.3"
git push -u origin release/1.3.3
gh pr create --base main --head release/1.3.3 --title "Prepare release 1.3.3" --body "Prepare the reviewed 1.3.3 release versions and changelog."
# Open, review and merge the version PR; refresh main before continuing.
git switch main
git pull --ff-only
# Write reviewed English notes and the tagged changelog link to /tmp/wherdr-1.3.3.md.
GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner -q .nameWithOwner)" GITHUB_REF_NAME=v1.3.3 node scripts/check-release-notes.mjs < /tmp/wherdr-1.3.3.md
gh release create v1.3.3 --target "$(git rev-parse HEAD)" --draft --title "wherdr 1.3.3" --notes-file /tmp/wherdr-1.3.3.md
git tag v1.3.3
git push origin v1.3.3
release_run=$(gh run list --workflow release.yml --commit "$(git rev-parse HEAD)" --json databaseId --jq '.[0].databaseId')
# If no run appears yet, wait for GitHub to register the tag and repeat the lookup.
gh run watch "$release_run" --exit-status
gh run list --workflow npm.yml --limit 3
# MANDATORY while the tap secret is absent. Run only after release.yml succeeds:
sh scripts/bump-homebrew.sh 1.3.3 "$(gh repo view --json owner -q .owner.login)"
# Inspect the readiness workflow; optionally request an immediate check:
gh workflow run release-ready.yml --ref main
```

Use Node.js 22 for npm commands (on the project Pi, use Docker and the shared heavy-operation
lock for installation/build/tests). Do not manually publish the draft or mark it latest ahead
of these checks. A GitHub release created by `GITHUB_TOKEN` does not trigger other workflows;
all publication work is driven by the pushed tag, not `release: published` events.
