#!/bin/sh
# wherdr : installe la barre d'état invisible de Claude Code (quotas + empreinte
# du compte) pour l'utilisateur courant. Autonome (la barre d'état est incluse
# plus bas) : wherdr l'exécute tel quel sur une machine (bouton « Installer ») ou
# le donne à coller (« Copier la commande »). Sans danger à relancer :
#  - écrit la barre d'état dans ~/.claude/wherdr-statusline.sh (mise à jour) ;
#  - aucune `statusLine` dans ~/.claude/settings.json : ajoute la nôtre ;
#  - une autre `statusLine` (commande) : l'enchaîne derrière la nôtre, son
#    affichage reste le même ; copie de sauvegarde settings.json.bak-wherdr.
# Les quotas apparaissent après le prochain échange avec un Claude.
set -e
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mkdir -p "$dir"
# ---- barre d'état (n'affiche rien) ----
cat > "$dir/wherdr-statusline.sh.tmp" <<'WHERDR_STATUSLINE'
#!/bin/sh
# wherdr : barre d'état invisible de Claude Code (n'affiche rien). Elle garde
# seulement les quotas du compte (rate_limits, que Claude Code transmet à sa
# barre d'état après chaque échange) pour l'accueil de wherdr, et une empreinte
# du compte (hash tronqué de son identifiant, jamais l'identifiant ni l'email)
# pour distinguer les machines qui n'utilisent pas le même compte.
# Installée par install-claude-statusline.sh (dépôt herdr-web, README, « Quotas
# sur l'accueil »). Barre d'état existante : passée en argument, elle reçoit les
# mêmes données et son affichage est conservé (sh wherdr-statusline.sh 'cmd').
d=$(cat)
case "$d" in
  *'"rate_limits"'*)
    dir="$HOME/.cache/herdr-web"
    f="$dir/claude-status.json"
    mkdir -p "$dir" && printf '%s' "$d" > "$f.tmp" && mv "$f.tmp" "$f"
    # Empreinte : recalculée au plus toutes les 10 min (changement de compte).
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
echo "barre d'état écrite : $dir/wherdr-statusline.sh"
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
    print('déjà installée :', cur['command'])
    sys.exit(0)
if cur is None:
    d['statusLine'] = {'type': 'command', 'command': ours}
    print('barre d\'état ajoutée :', ours)
elif isinstance(cur, dict) and cur.get('type') == 'command' and cur.get('command'):
    d['statusLine'] = {**cur, 'command': ours + ' ' + shlex.quote(cur['command'])}
    print('barre d\'état existante enchaînée :', d['statusLine']['command'])
else:
    print('statusLine inconnue, rien changé :', json.dumps(cur), file=sys.stderr)
    sys.exit(1)
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
WHERDR_PY
