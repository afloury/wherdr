# The checks of "Reveal in Finder" / "Open" / "Open in editor", run on the machine
# that has `open` (macOS). Called with $1 = reveal | open, $2 = absolute path.
# Single source of truth: server/utils/reveal.ts embeds this file verbatim in its
# REVEAL_SCRIPT (tests/reveal.test.ts pins them together); scripts/install-host-open.sh
# copies it to the Mac for wherdr's "host open" key (scripts/wherdr-open.sh).
# Exit codes: 3 missing, 4 outside home, 5 not macOS, 6 `open` failed, 7 runnable.
p=$2
[ -e "$p" ] || exit 3
if command -v realpath >/dev/null 2>&1; then
  r=$(realpath "$p" 2>/dev/null) || exit 3
  h=$(realpath "$HOME" 2>/dev/null) || exit 4
elif [ -d "$p" ]; then
  r=$(cd -P "$p" 2>/dev/null && pwd -P) || exit 3
  h=$(cd -P "$HOME" 2>/dev/null && pwd -P) || exit 4
else
  d=$(cd -P "$(dirname "$p")" 2>/dev/null && pwd -P) || exit 3
  r="$d/$(basename "$p")"
  [ -L "$r" ] && [ "$1" = open ] && exit 4
  h=$(cd -P "$HOME" 2>/dev/null && pwd -P) || exit 4
fi
case "$r/" in "$h"/*) ;; *) exit 4 ;; esac
[ "$(uname -s)" = Darwin ] || exit 5
if [ "$1" = open ]; then
  case "$r" in *.app|*.app/*|*.command|*.tool|*.terminal|*.pkg|*.mpkg|*.workflow|*.scpt|*.applescript|*.jar|*.webloc|*.inetloc|*.fileloc|*.dmg) exit 7 ;; esac
  if [ -f "$r" ] && [ -x "$r" ]; then exit 7; fi
  # A folder opens in the configured editor (WH_OPEN_EDITOR, or the first line
  # of ~/.local/share/wherdr/editor — an app name for open -a); plain open
  # would give the file manager. Files: the LaunchServices default app.
  ed=${WH_OPEN_EDITOR:-}
  if [ -z "$ed" ] && [ -f "$HOME/.local/share/wherdr/editor" ]; then
    ed=$(head -n1 "$HOME/.local/share/wherdr/editor" | tr -d '[:space:]')
  fi
  if [ -d "$r" ] && [ -n "$ed" ]; then
    open -a "$ed" "$r" || exit 6
  else
    open "$r" || exit 6
  fi
else
  open -R "$r" || exit 6
fi
echo "$r"
