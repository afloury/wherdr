#!/bin/sh
# Automatic startup is silent and best effort; explicit operations report errors.
# Usage: sh bin/lib/install-skill.sh [auto|refresh|install|uninstall] [package root]
install_skill() (
  set -eu
  [ -n "${HOME:-}" ] && [ -d "$HOME" ] || exit 0
  root=${2:-$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd -P)}
  mode=${1:-auto}
  base=${WHERDR_DIR:-$HOME/wherdr}
  case "$base" in /*) ;; *) base="$PWD/$base" ;; esac
  dest="$base/skills/wherdr"
  state="$HOME/.local/state/wherdr"
  disabled="$state/skill-disabled"
  claude=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
  case "$claude" in /*) ;; *) claude="$HOME/$claude" ;; esac
  dirs() {
    [ ! -d "$claude" ] || printf '%s\n' "$claude/skills"
    if [ -d "$HOME/.agents" ] || [ -d "$HOME/.codex" ] || [ -d "$HOME/.omp" ]; then
      printf '%s\n' "$HOME/.agents/skills"
    fi
  }
  # Opt-out applies even to an explicit install; uninstall is always available.
  if [ "$mode" != uninstall ]; then
    [ "${WHERDR_SKILL:-}" != off ] || { echo 'wherdr skill: disabled by WHERDR_SKILL=off'; exit 0; }
    [ "$mode" = install ] || [ ! -e "$disabled" ] || exit 0
    [ -n "$(dirs)" ] || { echo 'wherdr skill: no installed agent found'; exit 0; }
  fi
  if [ "$mode" = uninstall ]; then
    mkdir -p "$state"
    [ ! -L "$disabled" ] || { echo 'wherdr skill: opt-out marker is a symlink' >&2; exit 1; }
    [ -f "$disabled" ] || : > "$disabled"
  fi
  # Never follow a foreign symlink at the managed copy or its metadata.
  [ ! -L "$dest" ] && [ ! -L "$dest/SKILL.md" ] && [ ! -L "$dest/.wherdr-managed" ] || {
    echo 'wherdr skill: foreign symlink left alone' >&2; exit 0;
  }
  owned=false
  [ ! -f "$dest/.wherdr-managed" ] || owned=true
  if [ -e "$dest" ] && [ "$owned" = false ]; then
    # Adopt an older plugin copy only when an agent links to this exact path.
    legacy=$(dirs | while IFS= read -r d; do
      if [ -L "$d/wherdr" ] && [ "$(readlink "$d/wherdr")" = "$dest" ]; then echo 1; fi
    done)
    [ -z "$legacy" ] || owned=true
    [ "$owned" = true ] || { echo 'wherdr skill: existing foreign copy left alone'; exit 0; }
  fi
  case "$mode" in
    auto|refresh|install)
      [ -f "$root/skills/wherdr/SKILL.md" ] || { echo 'wherdr skill: bundled SKILL.md is missing' >&2; exit 1; }
      mkdir -p "$dest"
      if ! cmp -s "$root/skills/wherdr/SKILL.md" "$dest/SKILL.md"; then
        tmp=$(mktemp "$dest/.SKILL.XXXXXX")
        trap 'rm -f "$tmp"' EXIT HUP INT TERM
        cp "$root/skills/wherdr/SKILL.md" "$tmp"
        chmod 644 "$tmp"
        mv -f "$tmp" "$dest/SKILL.md"
      fi
      [ -f "$dest/.wherdr-managed" ] || : > "$dest/.wherdr-managed"
      dirs | while IFS= read -r d; do
        link="$d/wherdr"
        record="$d/.wherdr-managed-target"
        # The record survives removal of an old WHERDR_DIR. A path's shape
        # alone never proves ownership of a dangling link.
        if [ -L "$link" ] && [ ! -e "$link" ] && [ -f "$record" ] && [ ! -L "$record" ] \
          && [ "$(cat "$record")" = "$(readlink "$link")" ]; then
          rm "$link"
        fi
        if [ ! -e "$link" ] && [ ! -L "$link" ]; then
          mkdir -p "$d"
          ln -s "$dest" "$link"
        fi
        if [ -L "$link" ] && [ "$(readlink "$link")" = "$dest" ] && [ ! -L "$record" ]; then
          if [ ! -f "$record" ] || [ "$(cat "$record")" != "$dest" ]; then printf '%s\n' "$dest" > "$record"; fi
        fi
      done
      [ "$mode" != install ] || rm -f "$disabled"
      echo 'wherdr skill: installed or already up to date'
      ;;
    uninstall)
      dirs | while IFS= read -r d; do
        if [ -L "$d/wherdr" ] && [ "$(readlink "$d/wherdr")" = "$dest" ]; then
          rm "$d/wherdr"
          [ -L "$d/.wherdr-managed-target" ] || rm -f "$d/.wherdr-managed-target"
        fi
      done
      if [ "$owned" = true ]; then
        rm -f "$dest/SKILL.md" "$dest/.wherdr-managed"
        rmdir "$dest" "$(dirname "$dest")" 2>/dev/null || true
      fi
      echo 'wherdr skill: uninstalled; automatic installation disabled'
      ;;
    *) echo 'usage: install-skill.sh [auto|refresh|install|uninstall] [package root]' >&2; exit 1 ;;
  esac
)
if [ "${1:-auto}" = auto ]; then
  ( install_skill "$@" ) >/dev/null 2>&1
  exit 0
else
  install_skill "$@"
fi
