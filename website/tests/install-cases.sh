#!/bin/sh
# Runs inside a throwaway node:22-alpine container (see install.test.sh).
# Stubs: docker, curl, herdr, uname, brew — every call is logged, nothing real runs.
set -u
fails=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; sed 's/^/       | /' /tmp/out; fi; }

adduser -D -h /home/alice alice >/dev/null 2>&1
mkdir -p /srv /stubs /opt/plugin/scripts
# The brew stub (run as alice) puts node back in /usr/local/bin.
chmod 777 /usr/local/bin
# owner/wherdr, as the installer names it.
REPO="$(sed -n 's/^  REPO="\(.*\)"$/\1/p' /opt/install)"
printf 'services:\n  herdr-web:\n    image: ${WHERDR_IMAGE:-example/wherdr:latest}\n' > /srv/docker-compose.yml

# docker: /tmp/no-docker-daemon makes `docker info` fail; /tmp/container-dir
# holds the compose folder of an existing `wherdr` container.
cat > /stubs/docker <<'EOF'
#!/bin/sh
echo "docker $*" >> /tmp/docker.log
[ -f /tmp/no-docker-daemon ] && [ "$1" = info ] && exit 1
case "$*" in
  "compose version --short") echo 2.29.0 ;;
  "compose version") echo "Docker Compose version v2.29.0" ;;
  "version --format"*) echo 27.0.0 ;;
  "inspect wherdr"*) [ -f /tmp/container-dir ] || exit 1; cat /tmp/container-dir ;;
  "compose pull"*) if [ -f /tmp/pull-fails ]; then echo "denied: requested access to the resource is denied" >&2; exit 1; fi ;;
  "compose up"*) touch /tmp/up ;;
esac
exit 0
EOF
# curl: files from /srv; 127.0.0.1 answers once /tmp/up exists, as wherdr
# unless /tmp/foreign exists.
cat > /stubs/curl <<'EOF'
#!/bin/sh
out=""; url=""; fmt=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -w) fmt="$2"; shift ;; --max-time) shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
echo "curl $url" >> /tmp/curl.log
case "$url" in
  http://127.0.0.1:*/manifest.webmanifest) [ -f /tmp/up ] && [ ! -f /tmp/foreign ] && echo '{ "id": "wherdr" }' ;;
  http://127.0.0.1:*) if [ -f /tmp/up ]; then [ -z "$fmt" ] || printf 200; else [ -z "$fmt" ] || printf 000; exit 7; fi ;;
  *) cp "/srv/$(basename "$url")" "$out" ;;
esac
EOF
# herdr: plugin install/link log their arguments and WHERDR_* environment;
# the "build" starts wherdr (/tmp/up) unless /tmp/build-fails exists.
mkdir -p /opt/stub; cat > /opt/stub/herdr <<'EOF'
#!/bin/sh
case "$1 ${2:-}" in
  "--version "*) echo "herdr $(cat /tmp/herdr-version 2>/dev/null || echo 0.9.3)" ;;
  "plugin list") [ -f /tmp/plugin-installed ] || exit 1
    echo '{"result":{"plugins":[{"plugin_root":"/opt/plugin","version":"1.3.0"}]}}' ;;
  "plugin install"|"plugin link")
    { echo "herdr $*"; env | grep '^WHERDR_' | sort; } >> /tmp/herdr.log
    [ -f /tmp/build-fails ] && exit 1
    touch /tmp/plugin-installed
    [ "$2" = install ] && touch /tmp/up ;;
esac
exit 0
EOF
cat > /opt/plugin/scripts/herdr-plugin.sh <<'EOF'
echo "plugin script: $* (WHERDR_DIR=${WHERDR_DIR:-})" >> /tmp/herdr.log
case "$1" in
  build) touch /tmp/up ;;
  key) echo "prefix+i" ;;
  phone) echo "PHONE STEPS FROM THE PLUGIN" ;;
  address) [ -f /tmp/tailnet ] && echo "https://box.example.ts.net:7683" || echo "http://localhost:${WHERDR_PORT:-7683}" ;;
esac
EOF
cat > /stubs/uname <<'EOF'
#!/bin/sh
if [ "${1:-}" = "-s" ] && [ -f /tmp/darwin ]; then echo Darwin; else /bin/uname "$@"; fi
EOF
# brew install node: brings node back (see no_node).
cat > /opt/stub/brew <<'EOF'
#!/bin/sh
echo "brew $*" >> /tmp/brew.log
[ "$*" = "install node" ] && cp /usr/local/bin/node.off /usr/local/bin/node
exit 0
EOF
chmod +x /stubs/* /opt/stub/herdr /opt/stub/brew

reset() {
  rm -rf /home/alice/wherdr /home/alice/.local /home/alice/.config /home/alice/.cache /home/alice/.herdr-projects \
    /tmp/docker.log /tmp/curl.log /tmp/herdr.log /tmp/brew.log /tmp/up /tmp/pull-fails /tmp/herdr-version /tmp/darwin \
    /tmp/no-docker-daemon /tmp/container-dir /tmp/plugin-installed /tmp/build-fails /tmp/foreign /tmp/tailnet /stubs/brew
  [ -f /usr/local/bin/node.off ] && mv /usr/local/bin/node.off /usr/local/bin/node
  mkdir -p /home/alice/.local/bin && cp /opt/stub/herdr /home/alice/.local/bin/herdr && chown -R alice /home/alice
}
no_node() { mv /usr/local/bin/node /usr/local/bin/node.off; }
# run [env…]: the installer as alice, piped like `curl … | sh`, with no terminal.
run() {
  su alice -s /bin/sh -c "cd /home/alice && env -u DISPLAY PATH=/stubs:/usr/bin:/bin WHERDR_SOURCE=https://example.invalid/src $* sh < /opt/install" > /tmp/out 2>&1 < /dev/null
}
has() { grep -q -- "$1" "$2" 2>/dev/null; }

# 1. Herdr.
reset; rm /home/alice/.local/bin/herdr
run && fail "missing Herdr refused" || check "missing Herdr: clear message with the install link, nothing installed" \
  'has "Herdr is not installed" /tmp/out && has "https://herdr.dev" /tmp/out && [ ! -f /tmp/herdr.log ]'
reset; echo 0.8.9 > /tmp/herdr-version
run && fail "Herdr 0.8.9 refused" || check "Herdr 0.8.9 refused" 'has "0.9.1 or newer" /tmp/out'
reset; echo 0.10.0 > /tmp/herdr-version
run && pass "Herdr 0.10.0 accepted (numeric compare)" || { fail "Herdr 0.10.0 accepted (numeric compare)"; cat /tmp/out; }

# 2. Fresh Linux server, no screen: the plugin, no browser, address and phone steps.
reset
run && pass "fresh install exits 0" || { fail "fresh install exits 0"; cat /tmp/out; }
check "installs the Herdr plugin" 'has "herdr plugin install $REPO --yes" /tmp/herdr.log'
check "passes the folder, the port and no-browser to the plugin" \
  'has "WHERDR_DIR=/home/alice/wherdr" /tmp/herdr.log && has "WHERDR_PORT=7683" /tmp/herdr.log && has "WHERDR_NO_BROWSER=1" /tmp/herdr.log'
check "headless: prints the address, an ssh tunnel and the plugin phone steps" \
  'has "wherdr is running" /tmp/out && has "http://localhost:7683" /tmp/out && has "ssh -L 7683:127.0.0.1:7683" /tmp/out && has "PHONE STEPS FROM THE PLUGIN" /tmp/out'
check "warns when the Herdr server is not running" 'has "herdr.sock" /tmp/out'
check "Docker usable: the plugin picks it (no runtime forced)" '! has "WHERDR_RUNTIME" /tmp/herdr.log && has "runs in a container" /tmp/out'
check "never runs sudo or compose up itself" '! grep -q sudo /tmp/docker.log && ! has "compose up" /tmp/docker.log'
check "names the panel key the plugin bound" 'has "prefix+i" /tmp/out'

# 3. A screen: the plugin opens the setup guide.
reset
run DISPLAY=:0; check "with a display: browser allowed, setup guide mentioned" \
  '! has "WHERDR_NO_BROWSER" /tmp/herdr.log && has "setup guide is open" /tmp/out && ! has "PHONE STEPS" /tmp/out'
# Already published on the tailnet and answering: that address is the one shown.
reset; touch /tmp/tailnet
run DISPLAY=:0; check "tailnet address published: shown instead of localhost, with the passkey hint" \
  'has "wherdr is running → https://box.example.ts.net:7683" /tmp/out && has "a passkey is tied to its address" /tmp/out && has "Also on this computer: http://localhost:7683" /tmp/out'
reset
run DISPLAY=:0 SSH_CONNECTION=1; check "over SSH: no browser even with a display" 'has "WHERDR_NO_BROWSER=1" /tmp/herdr.log'

# 4. Linux without Docker: Node.js is passed to the plugin; neither: clear message.
reset; touch /tmp/no-docker-daemon
run; check "no Docker: the plugin runs with Node.js" 'has "WHERDR_RUNTIME=/usr/local/bin/node" /tmp/herdr.log'
reset; touch /tmp/no-docker-daemon; no_node
run && fail "no Node.js, no Docker refused" || check "no Node.js, no Docker: both install links" \
  'has "nodejs.org" /tmp/out && has "docs.docker.com" /tmp/out && [ ! -f /tmp/herdr.log ]'
reset
run WHERDR_MODE=native; check "WHERDR_MODE=native goes to the plugin with Node.js" \
  'has "WHERDR_MODE=native" /tmp/herdr.log && has "WHERDR_RUNTIME=" /tmp/herdr.log'

# 5. macOS: Node.js, or Homebrew's, or a clear message.
reset; touch /tmp/darwin
run; check "macOS: plugin with Node.js, never Docker" \
  'has "WHERDR_RUNTIME=/usr/local/bin/node" /tmp/herdr.log && ! has "compose version" /tmp/docker.log'
reset; touch /tmp/darwin; no_node; cp /opt/stub/brew /stubs/brew
run && fail "macOS without Node.js, no terminal: stops" || check "macOS without Node.js, no terminal: proposes brew install node, runs nothing" \
  'has "brew install node" /tmp/out && [ ! -f /tmp/brew.log ] && [ ! -f /tmp/herdr.log ]'
reset; touch /tmp/darwin; no_node; cp /opt/stub/brew /stubs/brew
run WHERDR_YES=1; check "macOS without Node.js, WHERDR_YES=1: brew install node, then the plugin" \
  'has "brew install node" /tmp/brew.log && has "WHERDR_RUNTIME=/usr/local/bin/node" /tmp/herdr.log'
reset; touch /tmp/darwin; no_node
run && fail "macOS without Node.js nor Homebrew refused" || check "macOS without Node.js nor Homebrew: nodejs.org" 'has "nodejs.org" /tmp/out'

# 6. wherdr already running: never replaced.
reset; touch /tmp/up /tmp/plugin-installed
run; check "plugin wherdr running, no terminal: says so, no update" \
  'has "already runs" /tmp/out && has "answering no" /tmp/out && [ ! -f /tmp/herdr.log ]'
run WHERDR_YES=1; check "plugin wherdr running, WHERDR_YES=1: updates the plugin" 'has "herdr plugin install $REPO" /tmp/herdr.log && has "wherdr updated" /tmp/out'
reset; touch /tmp/up; echo /srv/prod > /tmp/container-dir
run WHERDR_YES=1; check "Docker wherdr of another folder running: left alone, update command shown" \
  'has "cd /srv/prod && docker compose pull" /tmp/out && [ ! -f /tmp/herdr.log ] && ! has "compose pull" /tmp/docker.log && ! has "compose up" /tmp/docker.log'
reset; echo /srv/prod > /tmp/container-dir
run && fail "stopped container of another folder: refused" || check "stopped container of another folder: refused, nothing installed" \
  'has "managed from /srv/prod" /tmp/out && [ ! -f /tmp/herdr.log ]'
run WHERDR_MODE=native WHERDR_PORT=7690; check "…but a native wherdr on another port is fine" 'has "WHERDR_PORT=7690" /tmp/herdr.log'
reset; touch /tmp/up
run; check "wherdr installed another way: nothing changed" 'has "installed another way" /tmp/out && [ ! -f /tmp/herdr.log ]'
reset; touch /tmp/up /tmp/foreign
run && fail "port taken by another program refused" || check "port taken by another program: WHERDR_PORT hint" 'has "WHERDR_PORT=7684" /tmp/out'

# 7. Plugin failures and a local checkout.
reset; touch /tmp/build-fails
run && fail "failed plugin install exits non-zero" || check "failed plugin install: points to its log" 'has "herdr plugin log list" /tmp/out'
reset
run WHERDR_PLUGIN=/opt/plugin; check "WHERDR_PLUGIN=folder: linked and built in place" \
  'has "herdr plugin link /opt/plugin" /tmp/herdr.log && has "plugin script: build (WHERDR_DIR=/home/alice/wherdr)" /tmp/herdr.log && has "wherdr is running" /tmp/out'

# 8. WHERDR_MODE=docker: Docker Compose by hand, no plugin.
reset
run WHERDR_MODE=docker && pass "docker: fresh install exits 0" || { fail "docker: fresh install exits 0"; cat /tmp/out; }
cmp -s /srv/docker-compose.yml /home/alice/wherdr/docker-compose.yml && pass "docker: docker-compose.yml downloaded" || fail "docker: docker-compose.yml downloaded"
check "docker: .env has PUID, HOME, PORT, no HERDR_BIN" \
  'has "PUID=$(id -u alice)" /home/alice/wherdr/.env && has "HOST_HOME=/home/alice" /home/alice/wherdr/.env && has "PORT=7683" /home/alice/wherdr/.env && ! has HERDR_BIN /home/alice/wherdr/.env'
check "docker: bind-mount folders created as the user" \
  '[ -d /home/alice/wherdr/data ] && [ -d /home/alice/.herdr-projects ] && [ "$(stat -c %U /home/alice/.cache/herdr-web)" = alice ]'
check "docker: pulls then starts, no plugin" 'has "compose pull" /tmp/docker.log && has "compose up -d" /tmp/docker.log && [ ! -f /tmp/herdr.log ]'
echo "# mine" >> /home/alice/wherdr/.env; rm /tmp/up
run WHERDR_MODE=docker; check "docker: second run keeps .env and the compose file" 'has "# mine" /home/alice/wherdr/.env && has "up to date" /tmp/out'
echo "# edited" >> /home/alice/wherdr/docker-compose.yml; rm /tmp/up
run WHERDR_MODE=docker; check "docker: edited compose kept without a terminal" 'has "# edited" /home/alice/wherdr/docker-compose.yml && has "answering no" /tmp/out'
rm /tmp/up
run WHERDR_MODE=docker WHERDR_YES=1; check "docker: WHERDR_YES=1 replaces it with a backup" \
  'cmp -s /srv/docker-compose.yml /home/alice/wherdr/docker-compose.yml && has "# edited" /home/alice/wherdr/docker-compose.yml.bak'
reset; touch /tmp/pull-fails
run WHERDR_MODE=docker && fail "docker: pull failure exits non-zero" || check "docker: pull failure explains the fallback, starts nothing" \
  'has "docker-compose.build.yml" /tmp/out && ! has "compose up" /tmp/docker.log'
reset; touch /tmp/no-docker-daemon
run WHERDR_MODE=docker && fail "docker: unreachable daemon refused" || check "docker: unreachable daemon refused, no sudo run" 'has "usermod -aG docker" /tmp/out'
reset; echo /srv/prod > /tmp/container-dir
run WHERDR_MODE=docker && fail "docker: container of another folder refused" || check "docker: never replaces the container of another folder" \
  'has "managed from /srv/prod" /tmp/out && ! has "compose up" /tmp/docker.log && [ ! -d /home/alice/wherdr ]'
reset; touch /tmp/darwin
run WHERDR_MODE=docker && fail "docker on macOS refused" || check "docker on macOS refused" 'has "Docker Desktop cannot reach" /tmp/out'

# 9. Root, bad mode, truncated download.
reset
env PATH=/stubs:/usr/bin:/bin sh < /opt/install > /tmp/out 2>&1 && fail "root refused" || check "root refused" 'has "not as root" /tmp/out'
reset
run WHERDR_MODE=podman && fail "bad WHERDR_MODE refused" || check "bad WHERDR_MODE refused" 'has "docker or native" /tmp/out'
reset
head -c 3000 /opt/install > /tmp/partial
su alice -s /bin/sh -c "cd && env PATH=/stubs:/usr/bin:/bin sh < /tmp/partial" > /tmp/out 2>&1 < /dev/null
[ ! -d /home/alice/wherdr ] && [ ! -f /tmp/herdr.log ] && [ ! -f /tmp/docker.log ] && pass "truncated script does nothing" || fail "truncated script does nothing"

echo
if [ "$fails" -eq 0 ]; then echo "all installer tests passed"; else echo "$fails installer test(s) failed"; exit 1; fi
