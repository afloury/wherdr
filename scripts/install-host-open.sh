#!/bin/sh
# Sets up "Reveal in Finder" / "Open" / Mod+Alt+O for wherdr running in a Docker
# container on this Mac. Run ON THE MAC (the container talks to it over SSH):
#
#   sh scripts/install-host-open.sh [--user <mac user>]
#
# What it does:
#   1. Creates a dedicated ed25519 key pair in the container's data folder
#      (data/host-open-key, data/host-open-key.pub) — the private half stays
#      with wherdr, which mounts data/ into the container.
#   2. Installs ~/.local/share/wherdr/{reveal.sh,wherdr-open.sh} on this Mac
#      and picks a folder editor (see below).
#   3. Adds one authorized_keys line for that key with a forced command that
#      only ever runs the reveal checks on the path wherdr passes. An existing
#      line for the same key is replaced in place, never duplicated.
# Then set in docker-compose.override.yml:
#   HERDR_WEB_HOST_OPEN_TARGET=<target>   (default host.docker.internal;
#                                         host.docker.internal does not resolve
#                                         on macOS itself, only in the container)
#   HERDR_WEB_HOST_OPEN_USER=<mac user>
# and rebuild: docker compose ... up -d (see README, "wherdr in Docker on a Mac").
set -eu

here=$(cd "$(dirname "$0")" && pwd)
data="$here/../data"
user=${USER:-$(id -un)}
target=host.docker.internal

while [ $# -gt 0 ]; do
  case "$1" in
    --user) user=$2; shift 2 ;;
    --target) target=$2; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

for f in reveal.sh wherdr-open.sh; do
  [ -f "$here/$f" ] || { echo "scripts/$f missing" >&2; exit 1; }
done

# 1. Key pair (created once, reused across reinstalls).
if [ ! -f "$data/host-open-key" ]; then
  mkdir -p "$data"
  ssh-keygen -q -t ed25519 -N '' -C wherdr-host-open -f "$data/host-open-key"
  echo "created $data/host-open-key(.pub)"
fi

# 2. reveal.sh and the forced-command wrapper on this Mac (the installer runs
#    here, so plain file copies; no SSH involved on this side).
d="$HOME/.local/share/wherdr"
mkdir -p "$d" && chmod 700 "$d"
cp "$here/reveal.sh" "$here/wherdr-open.sh" "$d/"
chmod +x "$d/reveal.sh" "$d/wherdr-open.sh"
echo "installed $d/{reveal.sh,wherdr-open.sh}"

# The editor that opens folders (Mod+Alt+O): the first installed of the usual
# suspects. Override anytime:
#   printf %s "Visual Studio Code" > ~/.local/share/wherdr/editor
if [ ! -f "$d/editor" ]; then
  for e in Zed "Visual Studio Code" Cursor "Sublime Text" TextMate; do
    if [ -d "/Applications/$e.app" ] || [ -d "$HOME/Applications/$e.app" ]; then
      printf %s "$e" > "$d/editor"
      echo "editor: $e"
      break
    fi
  done
  [ -f "$d/editor" ] || echo "editor: none found — set one: printf %s AppName > $d/editor"
fi

# 3. authorized_keys: one line for the key, forced command, never duplicated.
[ -d "$HOME/.ssh" ] || mkdir -p "$HOME/.ssh"
[ -f "$HOME/.ssh/authorized_keys" ] || : > "$HOME/.ssh/authorized_keys"
line="restrict,command=\"sh $d/wherdr-open.sh\" $(cat "$data/host-open-key.pub")"
keys="$HOME/.ssh/authorized_keys"
grep -v 'wherdr-host-open' "$keys" > "$keys.tmp" || : > "$keys.tmp"
printf '%s\n' "$line" >> "$keys.tmp"
mv "$keys.tmp" "$keys"
echo "authorized_keys updated (forced command: reveal checks only)"

# 2b. A per-user LaunchAgent that lives in the GUI (Aqua) login session. Apps can
#     only be LAUNCHED from the GUI session: `open` from an SSH session does not
#     start them. The wrapper hands commands to this agent over a spool file.
spool="$HOME/Library/Application Support/wherdr-open"
mkdir -p "$spool"
cp "$here/dev.wherdr.open.plist" "$HOME/Library/LaunchAgents/dev.wherdr.open.plist"
launchctl bootout "gui/$(id -u)/dev.wherdr.open" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.wherdr.open.plist" \
  && echo "agent dev.wherdr.open loaded (GUI session)" \
  || echo "WARNING: could not load dev.wherdr.open agent — folder open may not work"

cat <<EOF

Next: in docker-compose.override.yml set
  environment:
    - HERDR_WEB_HOST_OPEN_TARGET=$target
    - HERDR_WEB_HOST_OPEN_USER=$user
then rebuild the container (README, "wherdr in Docker on a Mac").
EOF
