#!/bin/sh
# Forced command for wherdr's "host open" SSH key (authorized_keys on this Mac):
# a wherdr container on this machine may ask the Mac to reveal / open a path,
# nothing else. Installed by scripts/install-host-open.sh; see README,
# "wherdr in Docker on a Mac: Reveal in Finder and Open".
#
# The container sends exactly one of:
#   open <reveal|open> <base64 path>      — run the reveal checks on the path
#   install <reveal.sh|wherdr-open.sh>    — replace that file (content on stdin)
# Parsing is by whitelist, never eval; the checks (exists, under $HOME, never an
# app or script) live in reveal.sh, the same file the wherdr server runs directly
# on a native Mac.
set -u

D="$HOME/.local/share/wherdr"
REVEAL="${WH_OPEN_REVEAL:-$D/reveal.sh}"

set -- $SSH_ORIGINAL_COMMAND
[ "$#" -ge 2 ] || { echo "wherdr-open: unexpected request" >&2; exit 126; }
if [ "$1" = open ]; then
  [ "$#" -eq 3 ] || { echo "wherdr-open: unexpected request" >&2; exit 126; }
elif [ "$1" = install ]; then
  [ "$#" -eq 2 ] || { echo "wherdr-open: unexpected request" >&2; exit 126; }
else
  echo "wherdr-open: unexpected request" >&2
  exit 126
fi

b64ok() { case "$1" in *[!A-Za-z0-9+/=]*|'') return 1 ;; esac }
decode() { printf '%s' "$1" | base64 -D 2>/dev/null || printf '%s' "$1" | base64 -d 2>/dev/null; }

if [ "$1" = install ]; then
  # $2 is the plain file name; the new content arrives on stdin.
  case "$2" in
    reveal.sh|wherdr-open.sh) ;;
    *) echo "wherdr-open: unexpected file" >&2; exit 126 ;;
  esac
  d="$D/.incoming.$$"
  cat > "$d" && mv "$d" "$D/$2" && chmod +x "$D/$2" || { rm -f "$d"; echo "wherdr-open: install failed" >&2; exit 1; }
  echo "installed $D/$2"
  exit 0
fi

case "$2" in reveal|open) ;; *) echo "wherdr-open: unexpected mode" >&2; exit 126 ;; esac
b64ok "$3" || { echo "wherdr-open: bad path encoding" >&2; exit 126; }
p=$(decode "$3") || { echo "wherdr-open: bad path encoding" >&2; exit 126; }
[ -n "$p" ] || { echo "wherdr-open: empty path" >&2; exit 126; }
[ -f "$REVEAL" ] || { echo "wherdr-open: reveal.sh not found" >&2; exit 126; }

# GUI apps can only be launched from the GUI (Aqua) login session; `open` called
# from an SSH session silently fails to start them. Hand the job to a per-user
# LaunchAgent (dev.wherdr.open, installed by scripts/install-host-open.sh) that
# lives in the GUI session: write the command to a spool file, kickstart the
# agent, and the agent runs it as the logged-in user.
if [ "$2" = open ] && [ -z "${WH_OPEN_REVEAL:-}" ] && [ -d "$HOME/Library/LaunchAgents" ] && launchctl print "gui/$(id -u)/dev.wherdr.open" >/dev/null 2>&1; then
  spool="$HOME/Library/Application Support/wherdr-open/spool"
  q=$(printf '%s' "$p" | sed "s/'/'\\\\''/g")
  printf 'sh %s/reveal.sh open %q\n' "$D" "$q" > "$spool"
  launchctl kickstart -k "gui/$(id -u)/dev.wherdr.open" >/dev/null 2>&1
  echo "$p"
  exit 0
fi

exec /bin/sh "$REVEAL" "$2" "$p"
