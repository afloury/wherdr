# Releasing wherdr

Publishing a version requires the user's explicit approval. Never republish a package held
for npm review. No new secret is needed: GitHub uses `GITHUB_TOKEN`, npm uses OIDC Trusted
Publishing (`npm.yml`), and the tap uses the existing optional `HOMEBREW_TAP_TOKEN`.

1. Merge reviewed changes, including the release workflows, into `main`. The site workflow
   deploys relevant changes on pushes to `main`, independently of tags and npm.
2. Set the same version in `package.json`, `package-lock.json` and `herdr-plugin.toml`.
   Move the Unreleased changelog into a dated version entry. Run tests, typecheck and leak
   checks; review and merge this version commit before tagging it.
3. Create the GitHub release as a **draft**, with English notes under New / Improved /
   Fixed / Update. Push its version tag only after these notes are ready.
4. The tag starts `release.yml` and `npm.yml` independently. `release.yml` builds a multiarch
   Docker image and runs `npm pack` (prepack builds Nitro, includes `skills/wherdr`, resolves
   linked packages). It attaches `wherdr-X.Y.Z.tgz` and `wherdr-X.Y.Z.tgz.sha256` to the draft.
   After both jobs succeed, it publishes the release with `latest=false`. Docker and the
   public GitHub package are now usable; native plugins use the verified archive. A failed
   image or package job leaves the release draft; fix and rerun the failed jobs.
5. The Homebrew job updates the formula URL and SHA from GitHub, without waiting for npm.
   Without the existing tap token, run the fallback below after the release is public.
   Homebrew still uses npm to install the local archive and fetch its third-party dependency;
   it does not need the new **wherdr version** to be available on npm.
6. `npm.yml` waits for the attached archive (up to 30 minutes), verifies it, then publishes
   that exact file with provenance. npm moderation may still delay registry availability.
   If the assets were too slow to arrive, rerun the failed download job before any successful
   publication; never retry a successful `npm publish` merely because moderation is pending.
7. `release-ready.yml` checks hourly and after npm/release workflow completion. Once npm's
   tarball and `latest` tag, and the Homebrew formula are ready, it marks the GitHub release
   `latest`. Existing 1.3.x apps read this marker and can then safely use their npm updater.
   New apps read published stable releases directly, checking npm or the formula for their
   own installation mode. No update notice is offered while that channel is unavailable.

An old plugin can get the release immediately via **U** in Herdr or the one-command installer;
its old in-app Update button waits for the legacy channel. Plugin installation keeps its existing source-build fallback when no verified archive is
available, including older releases and the interval between the version commit and the tag. Keep the previous npm version,
GitHub assets, and Homebrew keg available for automatic health-check rollback.

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
# Write reviewed English New / Improved / Fixed / Update notes to /tmp/wherdr-1.3.3.md.
gh release create v1.3.3 --target "$(git rev-parse HEAD)" --draft --title "wherdr 1.3.3" --notes-file /tmp/wherdr-1.3.3.md
git tag v1.3.3
git push origin v1.3.3
gh run list --workflow release.yml --limit 3
gh run list --workflow npm.yml --limit 3
# Only if the automatic Homebrew job skipped (no tap token):
sh scripts/bump-homebrew.sh 1.3.3 "$(gh repo view --json owner -q .owner.login)"
# Inspect the readiness workflow; optionally request an immediate check:
gh workflow run release-ready.yml --ref main
```

Use Node.js 22 for npm commands (on the project Pi, use Docker and the shared heavy-operation
lock for installation/build/tests). Do not manually publish the draft or mark it latest ahead
of these checks. A GitHub release created by `GITHUB_TOKEN` does not trigger other workflows;
all publication work is driven by the pushed tag, not `release: published` events.
