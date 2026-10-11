#!/bin/sh
# Run on the HOST after pulling an image; no container is started, no home mounted.
# Usage: sh bin/install-docker-skill.sh <image>
(
  set -eu
  [ -n "${1:-}" ] || exit 0
  tmp=$(mktemp -d)
  container=
  trap '[ -z "$container" ] || docker rm "$container" >/dev/null 2>&1; rm -rf "$tmp"' EXIT HUP INT TERM
  container=$(docker create "$1")
  mkdir -p "$tmp/bin/lib"
  docker cp "$container:/app/skills" "$tmp/skills"
  docker cp "$container:/app/bin/lib/install-skill.sh" "$tmp/bin/lib/install-skill.sh"
  sh "$tmp/bin/lib/install-skill.sh" install "$tmp"
) >/dev/null 2>&1 || true
