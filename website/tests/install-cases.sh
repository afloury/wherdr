#!/bin/sh
# Runs inside a throwaway node:22-alpine container (see install.test.sh).
# Stubs: docker, curl, herdr, uname — every call is logged, nothing real runs.
set -u
fails=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; fails=$((fails + 1)); }

adduser -D -h /home/alice alice >/dev/null 2>&1
mkdir -p /srv /stubs
printf 'services:\n  herdr-web:\n    image: ${WHERDR_IMAGE:-example/wherdr:latest}\n' > /srv/docker-compose.yml

cat > /stubs/docker <<'EOF'
#!/bin/sh
echo "docker $*" >> /tmp/docker.log
[ -f /tmp/no-docker-daemon ] && [ "$1" = info ] && exit 1
case "$*" in
  "compose version --short") echo 2.29.0 ;;
  "compose version") echo "Docker Compose version v2.29.0" ;;
  "version --format"*) echo 27.0.0 ;;
  "compose pull"*) if [ -f /tmp/pull-fails ]; then echo "denied: requested access to the resource is denied" >&2; exit 1; fi ;;
  "compose up"*) touch /tmp/up ;;
esac
exit 0
EOF
cat > /stubs/curl <<'EOF'
#!/bin/sh
# -fsSL URL -o FILE: serve /srv/<basename>; -fs -o /dev/null … URL: up once started.
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; --max-time) shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
echo "curl $url" >> /tmp/curl.log
case "$url" in
  http://127.0.0.1:*) [ -f /tmp/up ] ;;
  *) cp "/srv/$(basename "$url")" "$out" ;;
esac
EOF
mkdir -p /opt/stub; cat > /opt/stub/herdr <<'EOF'
#!/bin/sh
echo "herdr $(cat /tmp/herdr-version 2>/dev/null || echo 0.9.1)"
EOF
cat > /stubs/uname <<'EOF'
#!/bin/sh
if [ "${1:-}" = "-s" ] && [ -f /tmp/darwin ]; then echo Darwin; else /bin/uname "$@"; fi
EOF
chmod +x /stubs/* /opt/stub/herdr

reset() {
  rm -rf /home/alice/wherdr /home/alice/.local /home/alice/.config /home/alice/.cache /home/alice/.herdr-projects \
    /tmp/docker.log /tmp/curl.log /tmp/up /tmp/pull-fails /tmp/herdr-version /tmp/darwin /tmp/no-docker-daemon
  mkdir -p /home/alice/.local/bin && cp /opt/stub/herdr /home/alice/.local/bin/herdr && chown -R alice /home/alice
}
# run [env…]: the installer as alice, piped like `curl … | sh`, with no terminal.
run() {
  su alice -s /bin/sh -c "cd /home/alice && env PATH=/stubs:/usr/bin:/bin WHERDR_SOURCE=https://example.invalid/src $* sh < /opt/install" > /tmp/out 2>&1 < /dev/null
}
has() { grep -q -- "$1" "$2"; }

# 1. Fresh install.
reset
if run; then pass "fresh install exits 0"; else fail "fresh install exits 0"; cat /tmp/out; fi
cmp -s /srv/docker-compose.yml /home/alice/wherdr/docker-compose.yml && pass "docker-compose.yml downloaded" || fail "docker-compose.yml downloaded"
has "PUID=$(id -u alice)" /home/alice/wherdr/.env && has "HOST_HOME=/home/alice" /home/alice/wherdr/.env && has "PORT=7683" /home/alice/wherdr/.env \
  && pass ".env has PUID, HOME, PORT" || fail ".env has PUID, HOME, PORT"
! has "HERDR_BIN" /home/alice/wherdr/.env && pass "no HERDR_BIN for ~/.local/bin/herdr" || fail "no HERDR_BIN for ~/.local/bin/herdr"
[ -d /home/alice/wherdr/data ] && [ -d /home/alice/.config/herdr ] && [ -d /home/alice/.cache/herdr-web ] && [ -d /home/alice/.herdr-projects ] \
  && [ "$(stat -c %U /home/alice/.cache/herdr-web)" = alice ] && pass "bind-mount folders created as the user" || fail "bind-mount folders created as the user"
has "compose pull" /tmp/docker.log && has "compose up -d" /tmp/docker.log && pass "pulls then starts" || fail "pulls then starts"
has "wherdr is running" /tmp/out && has "tailscale serve --bg --https=7683" /tmp/out && pass "prints next steps" || fail "prints next steps"
has "herdr.sock" /tmp/out && pass "warns when the Herdr server is not running" || fail "warns when the Herdr server is not running"
grep -q sudo /tmp/docker.log && fail "never runs sudo" || pass "never runs sudo"

# 2. Second run: idempotent, .env kept.
echo "# mine" >> /home/alice/wherdr/.env
if run; then pass "second run exits 0"; else fail "second run exits 0"; fi
has "# mine" /home/alice/wherdr/.env && has ".env kept" /tmp/out && pass ".env kept on re-run" || fail ".env kept on re-run"
has "up to date" /tmp/out && pass "same compose file left alone" || fail "same compose file left alone"

# 3. Changed compose file: kept without a terminal, replaced with WHERDR_YES=1 (backup).
echo "# edited" >> /home/alice/wherdr/docker-compose.yml
run
has "# edited" /home/alice/wherdr/docker-compose.yml && has "answering no" /tmp/out && pass "edited compose kept without a terminal" || { fail "edited compose kept without a terminal"; cat /tmp/out; }
run WHERDR_YES=1
cmp -s /srv/docker-compose.yml /home/alice/wherdr/docker-compose.yml && has "# edited" /home/alice/wherdr/docker-compose.yml.bak \
  && pass "WHERDR_YES=1 replaces it with a backup" || fail "WHERDR_YES=1 replaces it with a backup"

# 4. Image not reachable: clean failure with the build-from-source path.
reset; touch /tmp/pull-fails
if run; then fail "pull failure exits non-zero"; else pass "pull failure exits non-zero"; fi
has "Could not pull the wherdr image" /tmp/out && has "docker-compose.build.yml" /tmp/out && pass "pull failure explains the fallback" || fail "pull failure explains the fallback"
has "compose up" /tmp/docker.log && fail "nothing started after a failed pull" || pass "nothing started after a failed pull"

# 5. Herdr versions.
reset; echo 0.8.9 > /tmp/herdr-version
run && fail "Herdr 0.8.9 refused" || { has "0.9.1 or newer" /tmp/out && pass "Herdr 0.8.9 refused" || fail "Herdr 0.8.9 refused"; }
reset; echo 0.10.0 > /tmp/herdr-version
run && pass "Herdr 0.10.0 accepted (numeric compare)" || { fail "Herdr 0.10.0 accepted (numeric compare)"; cat /tmp/out; }
reset; rm /home/alice/.local/bin/herdr
run && fail "missing Herdr refused" || { has "Herdr is not installed" /tmp/out && pass "missing Herdr refused" || fail "missing Herdr refused"; }

# 6. Docker problems.
reset; touch /tmp/no-docker-daemon
run && fail "unreachable daemon refused" || { has "usermod -aG docker" /tmp/out && pass "unreachable daemon refused, no sudo run" || fail "unreachable daemon refused, no sudo run"; }
reset
su alice -s /bin/sh -c "cd && env PATH=/usr/bin:/bin sh < /opt/install" > /tmp/out 2>&1 < /dev/null \
  && fail "missing docker refused" || { has "Docker is not installed" /tmp/out && pass "missing docker refused" || fail "missing docker refused"; }

# 7. Root and macOS.
reset
env PATH=/stubs:/usr/bin:/bin sh < /opt/install > /tmp/out 2>&1 && fail "root refused" || { has "not as root" /tmp/out && pass "root refused" || fail "root refused"; }
reset; touch /tmp/darwin
run && fail "macOS: no Docker install" || { has "npm ci && npm run build && npm start" /tmp/out && [ ! -d /home/alice/wherdr ] && pass "macOS: prints the native steps, writes nothing" || fail "macOS: prints the native steps, writes nothing"; }

# 8. Truncated download runs nothing (everything is inside main()).
reset
head -c 3000 /opt/install > /tmp/partial
su alice -s /bin/sh -c "cd && env PATH=/stubs:/usr/bin:/bin sh < /tmp/partial" > /tmp/out 2>&1 < /dev/null
[ ! -d /home/alice/wherdr ] && [ ! -f /tmp/docker.log ] && pass "truncated script does nothing" || fail "truncated script does nothing"

echo
if [ "$fails" -eq 0 ]; then echo "all installer tests passed"; else echo "$fails installer test(s) failed"; exit 1; fi
