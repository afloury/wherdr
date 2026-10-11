#!/bin/sh
# Shared, best-effort host-side installer. No agent configuration is created.
# Usage: sh bin/lib/install-skill.sh [install|uninstall] [package root]
(
  set -eu
  root=${2:-$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd -P)}
  dest="${WHERDR_DIR:-$HOME/wherdr}/skills/wherdr"
  claude="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  dirs() {
    [ ! -d "$claude" ] || printf '%s\n' "$claude/skills"
    if [ -d "$HOME/.agents" ] || [ -d "$HOME/.codex" ] || [ -d "$HOME/.omp" ]; then
      printf '%s\n' "$HOME/.agents/skills"
    fi
  }
  [ -n "$(dirs)" ] || exit 0
  # Never follow a foreign symlink at the managed copy, including SKILL.md.
  [ ! -L "$dest" ] && [ ! -L "$dest/SKILL.md" ] && [ ! -L "$dest/.wherdr-managed" ] || exit 0
  if [ -e "$dest" ] && [ ! -f "$dest/.wherdr-managed" ]; then
    # Adopt the copy made by older plugins only when an agent links to it.
    legacy=$(dirs | while IFS= read -r d; do
      if [ -L "$d/wherdr" ] && [ "$(readlink "$d/wherdr")" = "$dest" ]; then echo 1; fi
    done)
    [ -n "$legacy" ] || exit 0
  fi
  case "${1:-install}" in
    install)
      [ -f "$root/skills/wherdr/SKILL.md" ] || exit 0
      mkdir -p "$dest"
      # Atomic replacement: concurrent starts cannot leave a partial skill.
      tmp=$(mktemp "$dest/.SKILL.XXXXXX")
      trap 'rm -f "$tmp"' EXIT HUP INT TERM
      cp "$root/skills/wherdr/SKILL.md" "$tmp"
      chmod 644 "$tmp"
      mv -f "$tmp" "$dest/SKILL.md"
      : > "$dest/.wherdr-managed"
      dirs | while IFS= read -r d; do
        link="$d/wherdr"
        if [ ! -e "$link" ] && [ ! -L "$link" ]; then
          mkdir -p "$d" && ln -s "$dest" "$link" || true
        fi
      done
      ;;
    uninstall)
      dirs | while IFS= read -r d; do
        if [ -L "$d/wherdr" ] && [ "$(readlink "$d/wherdr")" = "$dest" ]; then rm "$d/wherdr"; fi
      done
      rm -f "$dest/SKILL.md" "$dest/.wherdr-managed"
      rmdir "$dest" "$(dirname "$dest")" 2>/dev/null || true
      ;;
  esac
) >/dev/null 2>&1 || true
