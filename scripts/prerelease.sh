#!/usr/bin/env bash
# Rolling prerelease of the develop branch (.github/workflows/develop-prerelease.yml).
# The release v<version> (version of herdr-plugin.toml, e.g. 2.0.0-dev) is
# rebuilt on every push: its tag moves to the pushed commit and its files are
# replaced, so a machine can install v2 with fetch_prebuilt
# (scripts/herdr-plugin.sh) and never compile it.
#
#   prerelease.sh version                 print the version, if it is a prerelease one
#   prerelease.sh package <tgz> <sha>     check the npm pack archive, write <tgz>.sha256,
#                                         COMMIT and prerelease-notes.md next to it
#   prerelease.sh publish <tgz> <sha>     move the tag, update the release, upload the files
#
# publish needs gh with GH_REPO (owner/name) and a token that can write contents.
# Safety: only a version with a prerelease suffix (X.Y.Z-something) is ever
# published, and an existing release of that tag must be a published
# prerelease: a stable vX.Y.Z tag or release is never moved or edited.
set -euo pipefail

die() { echo "prerelease: $*" >&2; exit 1; }

plugin_version() { sed -n 's/^version = "\(.*\)"$/\1/p' herdr-plugin.toml | head -n 1; }

cmd_version() {
  local version pkg
  version="$(plugin_version)"
  pkg="$(node -p "require('./package.json').version")"
  [ "$version" = "$pkg" ] || die "herdr-plugin.toml ($version) and package.json ($pkg) disagree"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z.-]+$ ]] \
    || die "version $version is not a prerelease (X.Y.Z-suffix): stable releases go through release.yml"
  echo "$version"
}

check_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die "not a full commit SHA: $1"; }

# The archive must hold what fetch_prebuilt installs, and nothing compiled for
# one platform: the same file runs on linux-arm64 (Raspberry Pi) and x64.
check_archive() {
  local tgz="$1" tmp missing=0 native
  tmp="$(mktemp -d)"
  tar -xzf "$tgz" -C "$tmp"
  for entry in .output/server/index.mjs bin/wherdr.mjs bin/lib/install-skill.sh bin/lib/verify-release.mjs \
    package.json skills/wherdr/SKILL.md; do
    [ -f "$tmp/package/$entry" ] || { echo "prerelease: missing package/$entry" >&2; missing=1; }
  done
  native="$(node -e '
    const fs = require("node:fs"), path = require("node:path")
    const MAGIC = ["7f454c46", "feedface", "feedfacf", "cefaedfe", "cffaedfe"]
    const hits = []
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name === "prebuilds") hits.push(p); else walk(p); continue }
        if (!e.isFile()) continue
        if (/\.(node|so|dylib|dll|exe)$/.test(e.name) || e.name === "binding.gyp") { hits.push(p); continue }
        const fd = fs.openSync(p, "r"), b = Buffer.alloc(4)
        const n = fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd)
        if (n === 4 && MAGIC.includes(b.toString("hex"))) hits.push(p)
      }
    }
    walk(process.argv[1])
    console.log(hits.map(h => path.relative(process.argv[1], h)).join("\n"))
  ' "$tmp")"
  rm -rf "$tmp"
  [ "$missing" = 0 ] || die "incomplete package $tgz"
  [ -z "$native" ] || die "native code in the package (it would not run on another platform):
$native"
}

cmd_package() {
  local tgz="${1:?usage: prerelease.sh package <tgz> <sha>}" sha="${2:?commit SHA}" version dir name
  check_sha "$sha"
  version="$(cmd_version)"
  name="wherdr-$version.tgz"
  [ "$(basename "$tgz")" = "$name" ] || die "expected $name, got $(basename "$tgz")"
  check_archive "$tgz"
  dir="$(dirname "$tgz")"
  # The format bin/lib/verify-release.mjs reads, as release.yml writes it.
  (cd "$dir" && sha256sum "$name" > "$name.sha256")
  printf '%s\n' "$sha" > "$dir/COMMIT"
  node "$(dirname "${BASH_SOURCE[0]}")/prerelease-summary.mjs" "$sha" > "$dir/prerelease-notes.md"
  {
    echo
    echo "Rolling prerelease of the \`v2\` branch, rebuilt on every push. Not a stable release: never marked latest, never offered as an update."
    echo
    echo "Commit: \`$sha\`"
    echo
    echo "Built $(date -u '+%Y-%m-%d %H:%M UTC')${GITHUB_RUN_ID:+ by ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/$GITHUB_RUN_ID}."
    echo
    echo "\`COMMIT\` holds the commit of \`$name\`. It is removed while the files are replaced and attached last: when it is present, the archive matches it."
  } >> "$dir/prerelease-notes.md"
  echo "prerelease: $name for $sha checked"
}

cmd_publish() {
  local tgz="${1:?usage: prerelease.sh publish <tgz> <sha>}" sha="${2:?commit SHA}" version tag dir repo state assets exists
  check_sha "$sha"
  version="$(cmd_version)"
  tag="v$version"
  dir="$(dirname "$tgz")"
  repo="${GH_REPO:?GH_REPO is required}"
  for f in "$tgz" "$tgz.sha256" "$dir/COMMIT" "$dir/prerelease-notes.md"; do
    [ -f "$f" ] || die "missing $f (run: prerelease.sh package first)"
  done

  if state="$(gh release view "$tag" --json isPrerelease,isDraft --jq '"\(.isPrerelease) \(.isDraft)"' 2>/dev/null)"; then
    [ "$state" = "true false" ] || die "release $tag exists and is not a published prerelease ($state): left alone"
    # Gone while the archive changes: a reader that finds COMMIT finds its archive.
    assets="$(gh release view "$tag" --json assets --jq '.assets[].name')"
    if printf '%s\n' "$assets" | grep -qx COMMIT; then
      gh release delete-asset "$tag" COMMIT --yes
    fi
    exists=1
  else
    exists=0
  fi

  # The tag follows the pushed commit. Made with the workflow's token, it starts
  # no other workflow (release.yml and npm.yml listen to v* tags).
  if gh api "repos/$repo/git/refs/tags/$tag" >/dev/null 2>&1; then
    gh api -X PATCH "repos/$repo/git/refs/tags/$tag" -f sha="$sha" -F force=true >/dev/null
  else
    gh api -X POST "repos/$repo/git/refs" -f ref="refs/tags/$tag" -f sha="$sha" >/dev/null
  fi

  if [ "$exists" = 1 ]; then
    gh release edit "$tag" --prerelease --latest=false --title "wherdr $version" --notes-file "$dir/prerelease-notes.md"
  else
    gh release create "$tag" --verify-tag --prerelease --latest=false --title "wherdr $version" --notes-file "$dir/prerelease-notes.md"
  fi
  gh release upload "$tag" "$tgz" "$tgz.sha256" --clobber
  gh release upload "$tag" "$dir/COMMIT" --clobber
  echo "prerelease: $tag now at $sha"
}

case "${1:-}" in
  version) cmd_version ;;
  package) shift; cmd_package "$@" ;;
  publish) shift; cmd_publish "$@" ;;
  *) die "usage: $0 version | package <tgz> <sha> | publish <tgz> <sha>" ;;
esac
