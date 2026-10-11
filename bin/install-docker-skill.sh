#!/bin/sh
# Run on the HOST after pulling an image; no container is started, no home mounted.
# Usage: sh bin/install-docker-skill.sh <image> [refresh|install]
extract_skill() (
  set -eu
  [ -n "${1:-}" ] || { echo 'usage: install-docker-skill.sh <image> [refresh|install]' >&2; exit 1; }
  [ "${WHERDR_SKILL:-}" != off ] || { echo 'wherdr skill: disabled by WHERDR_SKILL=off'; exit 0; }
  if [ "${2:-install}" != install ] && [ -e "${HOME:-}/.local/state/wherdr/skill-disabled" ]; then exit 0; fi
  helper=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)/lib/install-skill.sh
  tmp=$(mktemp -d)
  container=
  trap '[ -z "$container" ] || docker rm "$container" >/dev/null 2>&1; rm -rf "$tmp"' EXIT HUP INT TERM
  container=$(docker create -- "$1")
  mkdir -p "$tmp/skills/wherdr"
  # Only data crosses the image boundary. The executed helper is local.
  docker cp "$container:/app/skills/wherdr/SKILL.md" "$tmp/skills/wherdr/SKILL.md"
  sh "$helper" "${2:-install}" "$tmp"
)
# Unlike startup, manual and plugin callers see failures and useful diagnostics.
extract_skill "$@"
