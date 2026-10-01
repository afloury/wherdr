#!/bin/sh
# wherdr: installs Claude Code's invisible status line (quotas + account
# fingerprint) for the current user. Self-contained (the status line is included
# below): wherdr runs it as is on a machine ("Install" button) or
# hands it out to paste ("Copy command"). Safe to run again:
#  - writes the status line to ~/.claude/wherdr-statusline.sh (update);
#  - no `statusLine` in ~/.claude/settings.json: adds ours;
#  - another `statusLine` (command): chains it behind ours, its
#    output stays the same; backup copy settings.json.bak-wherdr.
# Quotas show up after the next exchange with a Claude.
set -e
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mkdir -p "$dir"
# ---- status line (prints nothing) ----
cat > "$dir/wherdr-statusline.sh.tmp" <<'WHERDR_STATUSLINE'
#!/bin/sh
# wherdr: Claude Code's invisible status line (prints nothing). It only keeps
# the account quotas (rate_limits, which Claude Code passes to its
# status line after each exchange) for the wherdr home screen, and an account
# fingerprint (truncated hash of its ID, never the ID or the email)
# to tell apart machines that do not use the same account.
# Installed by install-claude-statusline.sh (wherdr repository, README, "Quotas
# on the home screen"). Existing status line: passed as an argument, it receives the
# same data and its output is kept (sh wherdr-statusline.sh 'cmd').
d=$(cat)
case "$d" in
  *'"rate_limits"'*)
    dir="$HOME/.cache/herdr-web"
    f="$dir/claude-status.json"
    mkdir -p "$dir" && printf '%s' "$d" > "$f.tmp" && mv "$f.tmp" "$f"
    # Fingerprint: recomputed at most every 10 min (account change).
    a="$dir/claude-account"
    if [ -z "$(find "$a" -mmin -10 2>/dev/null)" ]; then
      c="${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"
      id=$([ -r "$c" ] && tr -d '\n' < "$c" \
        | grep -o '"oauthAccount": *{[^}]*' | grep -o '"accountUuid": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
      if command -v sha256sum >/dev/null 2>&1; then sum=sha256sum; else sum='shasum -a 256'; fi
      if [ -n "$id" ]; then
        printf 'wherdr:%s' "$id" | $sum | cut -c1-16 > "$a.tmp" && mv "$a.tmp" "$a"
      else
        rm -f "$a"
      fi
    fi ;;
esac
if [ -n "$1" ]; then printf '%s' "$d" | sh -c "$1"; exit $?; fi
exit 0
WHERDR_STATUSLINE
chmod 755 "$dir/wherdr-statusline.sh.tmp"
mv "$dir/wherdr-statusline.sh.tmp" "$dir/wherdr-statusline.sh"
echo "status line written: $dir/wherdr-statusline.sh"
# ---- settings.json ----
[ -f "$dir/settings.json" ] || echo '{}' > "$dir/settings.json"
cp "$dir/settings.json" "$dir/settings.json.bak-wherdr"
python3 - "$dir/settings.json" "$dir/wherdr-statusline.sh" <<'WHERDR_PY'
import json, shlex, sys
path, script = sys.argv[1], sys.argv[2]
d = json.load(open(path))
ours = 'sh ' + shlex.quote(script)
cur = d.get('statusLine')
if isinstance(cur, dict) and 'wherdr-statusline.sh' in str(cur.get('command', '')):
    print('already installed:', cur['command'])
    sys.exit(0)
if cur is None:
    d['statusLine'] = {'type': 'command', 'command': ours}
    print('status line added:', ours)
elif isinstance(cur, dict) and cur.get('type') == 'command' and cur.get('command'):
    d['statusLine'] = {**cur, 'command': ours + ' ' + shlex.quote(cur['command'])}
    print('existing status line chained:', d['statusLine']['command'])
else:
    print('unknown statusLine, nothing changed:', json.dumps(cur), file=sys.stderr)
    sys.exit(1)
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
WHERDR_PY
