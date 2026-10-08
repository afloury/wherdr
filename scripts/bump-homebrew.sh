#!/bin/sh
# Points the Homebrew formula (<owner>/homebrew-tap, Formula/wherdr.rb) at a
# version already published on npm. Manual fallback for the `homebrew` job of
# .github/workflows/npm.yml when the HOMEBREW_TAP_TOKEN secret is missing.
# Uses the GitHub CLI authentication (`gh auth login`) to clone and push.
#
#   scripts/bump-homebrew.sh [version] [owner]
#
# version defaults to package.json's, owner to the owner of this checkout's GitHub repo.
set -eu

cd "$(dirname "$0")/.."
version=${1:-$(node -p 'require("./package.json").version' 2>/dev/null || sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)}
owner=${2:-$(gh repo view --json owner -q .owner.login)}
url="https://registry.npmjs.org/wherdr/-/wherdr-${version}.tgz"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "$url" -o "$tmp/wherdr.tgz" || { echo "wherdr@${version} is not on npm yet ($url)" >&2; exit 1; }
if command -v sha256sum >/dev/null; then
  sha=$(sha256sum "$tmp/wherdr.tgz" | cut -d' ' -f1)
else
  sha=$(shasum -a 256 "$tmp/wherdr.tgz" | cut -d' ' -f1)
fi
[ -n "$sha" ] || { echo "Could not compute sha256" >&2; exit 1; }

gh repo clone "${owner}/homebrew-tap" "$tmp/tap" -- -q
cd "$tmp/tap"
sed -E "s|^  url \".*\"|  url \"${url}\"|; s|^  sha256 \".*\"|  sha256 \"${sha}\"|" Formula/wherdr.rb > Formula/wherdr.rb.new
mv Formula/wherdr.rb.new Formula/wherdr.rb
if git diff --quiet; then echo "Formula already at ${version}."; exit 0; fi
git diff
git commit -qam "wherdr ${version}"
git push -q
echo "Formula/wherdr.rb now points at wherdr ${version} (sha256 ${sha})."
