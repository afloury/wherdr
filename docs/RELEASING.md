# Releasing wherdr

Publishing a version requires the user's explicit approval. Never republish a package held
for npm review. No new secret is needed: GitHub uses `GITHUB_TOKEN`, npm uses OIDC Trusted
Publishing (`npm.yml`), and the tap uses the existing optional `HOMEBREW_TAP_TOKEN`.

1. Prepare the version and notes in a PR targeting `develop`, the integration branch.
   `main` only receives reviewed releases; `v2` is no longer an integration branch.
   Require `checks` and `e2e` to be green on the exact preparation head, with the current
   `develop` merged in. After explicit approval, open a release PR from `develop` to `main`
   and require those checks again on its exact head before merging. The site workflow
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
4. The tag starts `release.yml` and `npm.yml` independently. `release.yml` runs `npm pack`
   (prepack builds Nitro, includes `skills/wherdr`, resolves linked packages). It attaches
   `wherdr-X.Y.Z.tgz` and `wherdr-X.Y.Z.tgz.sha256` to the draft. After the package job
   succeeds, it publishes the release with `latest=false`. The public GitHub package is now
   usable; native plugins compare the archive checksum. A failed package job leaves the
   release draft; fix and rerun the failed job.
5. The Homebrew job updates the formula URL and SHA from GitHub, without waiting for npm.
   **The manual Homebrew step is MANDATORY while `HOMEBREW_TAP_TOKEN` is absent**. Wait for `release.yml` to finish successfully first, so its
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

## herdr-projects tested version

wherdr installs one herdr-projects release, and offers an update to it on machines with an older
one: `PROJECTS_TESTED` in `shared/projectsPlugin.ts`. `PROJECTS_MIN` (1.2.1) is the oldest
release wherdr still reads; it moves only when wherdr drops one.

To move to a newer herdr-projects release:

1. Download its binary from GitHub (`gh release download vX.Y.Z -R eliasstravik/herdr-projects`)
   and check it against its `.sha256`. Run it with `HOME` set to an empty temporary folder and
   Herdr unreachable. Record `version`, `list --json`, `list --json --archived`,
   `details --json -- <id>`, `show --json -- <id>` and `coordinator --machine --json status`
   into `tests/recordings/herdr-projects-X.Y.Z/` (no personal paths or machine names).
   Also check that `tell`, `approve`, `after`, `archive`, `restore` and `coordinator … tell`
   still take the same arguments.
2. Set `PROJECTS_TESTED` to `X.Y.Z`, and point the recordings test in
   `tests/projectsTasks.test.ts` at the new folder.
3. If the release adds a feature worth naming, add it to `FEATURES` in
   `app/components/ProjectsPluginSettings.vue` (the update's one-line summary, FR + EN).
4. Run `npx vitest related --run shared/projectsPlugin.ts`: `tests/projectsPlugin.test.ts`
   fails until the install commands in `docs/board.md`, `docs/herdr-projects-1x.md` and
   `website/public/agent.md` name the new release.

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

## Rolling develop prerelease

`develop-prerelease.yml` rebuilds one prerelease on every push to the `develop` branch (the
integration branch; `main` only receives releases), so a machine can install develop from a prebuilt package (the plugin's GitHub download) and never compile it.
It publishes the version of `herdr-plugin.toml` (for example `2.0.0-dev`, before the stable version bump) as `v<version>`:

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

Once the version is stable, the workflow skips packaging and publication; it must not create a stable tag.

The rolling notes start with an Update summary of the first three top-level Unreleased
changelog entries and a link to the changelog at the packaged commit, followed by build
metadata. Keep these entries readable and current; packaging fails if they are absent or fail the same minimum-content check.

`scripts/prerelease.sh` does the checks and the publication. It refuses a version without a
prerelease suffix (`X.Y.Z-something`) and a release of that tag that is not a published
prerelease: stable versions keep going through the steps above. The tag is moved with
`GITHUB_TOKEN`, which starts neither `release.yml` nor `npm.yml`. The workflow runs from the
`develop` branch. A stable version deliberately disables rolling publication.

## Publishing the prepared 2.1.0 release

The preparation PR targets `develop`. Version 2.1.0 includes new task description editing,
bulk archiving and task limit controls as well as fixes, so it uses a minor increment from
2.0.1 rather than the initially proposed 2.0.2 patch. It introduces no intended breaking
change and needs no migration from 2.0.1.

After explicit approval, merge the reviewed preparation PR into `develop`, then review a
`develop` → `main` release PR. Require `checks` and `e2e` on the exact release head;
run the full CI workflow manually on that head before publication (release tags also run
full CI, but the publishing workflows do not wait for it). Do not tag or create even a
GitHub draft until these checks and the publication approval are complete.

In a clean checkout of the approved `main` commit, using Node.js 22:

```sh
git fetch origin
git merge --ff-only origin/main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
test "$(node -p "require('./package.json').version")" = 2.1.0
GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner -q .nameWithOwner)" GITHUB_REF_NAME=v2.1.0 node scripts/check-release-notes.mjs < docs/release-notes-2.1.0.md
git tag v2.1.0
# Prepare the reviewed draft before the tag push starts publication.
gh release create v2.1.0 --target "$(git rev-parse HEAD)" --draft --title "wherdr 2.1.0" --notes-file docs/release-notes-2.1.0.md
git push origin v2.1.0
```

Verify that `release.yml`, `npm.yml` and full tag CI actually started on the approved SHA.
If the existing tag push does not trigger them, stop and resolve the workflow trigger;
never move the tag or publish a different build. `release.yml` has no manual trigger.
Wait for packaging and publication to succeed, then perform the mandatory manual tap update
when the optional tap secret is absent:

```sh
sh scripts/bump-homebrew.sh 2.1.0 "$(gh repo view --json owner -q .owner.login)"
gh workflow run release-ready.yml --ref main
```

Do not manually publish the draft or mark it latest. npm publishes the attached archive
with provenance; npm moderation can delay availability. Readiness advances the legacy
channel only when npm and Homebrew are both ready. Never retry a successful npm publish.
