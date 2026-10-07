#!/bin/sh
# wherdr as a Herdr plugin (herdr-plugin.toml): build, start, stop, status,
# open, update and phone setup.
#
#   herdr plugin install <owner>/wherdr
#
# Two ways to run wherdr, picked once at install time and kept in
# $WHERDR_DIR/plugin.env:
#   docker  Linux with Docker Compose v2 usable by this user: the published
#           image, run from $WHERDR_DIR exactly like https://wherdr.dev/install.
#   native  everywhere else (always on macOS: Docker Desktop cannot reach
#           Herdr's Unix socket): Node.js 22 runs the build made in the
#           plugin folder, detached, with its pid and log in $WHERDR_DIR.
# WHERDR_MODE=native (or docker) in the environment of `herdr plugin install`
# forces the choice; edit plugin.env to change it later, then run Update.
#
# Safety rules:
#   - nothing global is installed, no sudo; files are only written to the
#     plugin folder and $WHERDR_DIR (default ~/wherdr), plus the folders the
#     Docker setup mounts (~/.config/herdr, ~/.cache/herdr-web…);
#   - start does nothing when something already answers on the port: a
#     wherdr started another way (Docker, systemd, by hand) is never touched,
#     and no second wherdr is started;
#   - stop only stops what this plugin started (its pid, or the container of
#     its own compose folder).
#
# Settings ($WHERDR_DIR/plugin.env, or the environment):
#   WHERDR_MODE  docker | native        (default: chosen at install)
#   WHERDR_PORT  local port              (default: 7683)
#   APP_URL      private HTTPS address   (native; Docker reads its .env)
#   WHERDR_RUNTIME  absolute path of node / bun (native; found at install)

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
# Build commands get no plugin environment: the folder chosen at install
# time is remembered in the plugin checkout for the runtime commands.
if [ -z "${WHERDR_DIR:-}" ] && [ -f "$ROOT/.wherdr-dir" ]; then
  WHERDR_DIR="$(cat "$ROOT/.wherdr-dir")"
fi
DIR="${WHERDR_DIR:-$HOME/wherdr}"
CONF="$DIR/plugin.env"
PIDFILE="$DIR/wherdr.pid"
LOGFILE="$DIR/wherdr.log"
# GitHub source of this plugin: its manifest id with "/" for "." (owner.wherdr).
SOURCE="$(sed -n 's/^id = "\(.*\)"$/\1/p' "$ROOT/herdr-plugin.toml" | head -n 1 | tr . /)"
# container_name of the compose file (wherdr unless you renamed it).
CONTAINER="$(sed -n 's/^ *container_name: *//p' "$DIR/docker-compose.yml" 2>/dev/null | head -n 1)"
CONTAINER="${CONTAINER:-wherdr}"
# The environment wins over plugin.env.
ENV_MODE="${WHERDR_MODE:-}" ENV_PORT="${WHERDR_PORT:-}" ENV_APP_URL="${APP_URL:-}" ENV_RUNTIME="${WHERDR_RUNTIME:-}"
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi
MODE="${ENV_MODE:-${WHERDR_MODE:-}}"
PORT="${ENV_PORT:-${WHERDR_PORT:-7683}}"
APP_URL="${ENV_APP_URL:-${APP_URL:-}}"
# Native mode: absolute path of the node (or bun) that runs the server. Herdr
# runs actions with its server's PATH, which often lacks nvm / n / fnm folders.
RUNTIME="${ENV_RUNTIME:-${WHERDR_RUNTIME:-}}"
URL="http://localhost:$PORT"

say() { printf '%s\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

# Any HTTP answer counts (a locked wherdr answers 401): the port is taken.
answers() {
  if command -v curl >/dev/null 2>&1; then
    code="$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
    [ -n "$code" ] && [ "$code" != "000" ]
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1
  else
    die "curl or nc is needed to check port $PORT."
  fi
}

docker_usable() {
  [ "$(uname -s)" = "Linux" ] || return 1
  command -v docker >/dev/null 2>&1 || return 1
  docker compose version >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1
}

# Major version of a node binary, 0 when it is not one.
node_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

# A usable runtime: Node.js 22 or newer, or Bun (it runs the built server too).
runtime_ok() {
  [ -n "$1" ] && [ -x "$1" ] && [ ! -d "$1" ] || return 1
  case "$(basename "$1")" in
    bun) "$1" --version >/dev/null 2>&1 ;;
    *) [ "$(node_major "$1")" -ge 22 ] 2>/dev/null ;;
  esac
}

# Absolute path of the runtime: WHERDR_RUNTIME, then node on the PATH, then the
# usual install folders (n, nvm, Volta, fnm, asdf, Homebrew), then Bun.
# Prints nothing and fails when none is found.
find_runtime() {
  for c in "$RUNTIME" "$(command -v node 2>/dev/null || true)" \
    "$HOME/.n/bin/node" "${N_PREFIX:+$N_PREFIX/bin/node}" \
    $(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -r -V) \
    "$HOME/.volta/bin/node" \
    $(ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node "$HOME"/.fnm/node-versions/*/installation/bin/node 2>/dev/null | sort -r -V) \
    "$HOME/.asdf/shims/node" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node \
    "$(command -v bun 2>/dev/null || true)" "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    if runtime_ok "$c"; then echo "$c"; return 0; fi
  done
  return 1
}

RUNTIME_HELP="Node.js 22 or newer (or Bun) is required to run wherdr without Docker.
     Install it from https://nodejs.org, or set its absolute path in $CONF:
       WHERDR_RUNTIME=/path/to/node"

herdr_bin() {
  if [ -n "${HERDR_BIN_PATH:-}" ]; then echo "$HERDR_BIN_PATH"
  elif [ -x "$HOME/.local/bin/herdr" ]; then echo "$HOME/.local/bin/herdr"
  else command -v herdr 2>/dev/null || echo herdr
  fi
}

real_dir() { (cd "$1" 2>/dev/null && pwd -P) || echo "$1"; }

# Compose folder of the `wherdr` container, empty when there is none.
container_dir() {
  docker inspect "$CONTAINER" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null || true
}

# True when the `wherdr` container belongs to $DIR (or does not exist yet).
container_ours() {
  owner="$(container_dir)"
  [ -z "$owner" ] || [ "$(real_dir "$owner")" = "$(real_dir "$DIR")" ]
}

compose() { docker compose --project-directory "$DIR" -f "$DIR/docker-compose.yml" "$@"; }

native_pid() {
  [ -f "$PIDFILE" ] || return 1
  pid="$(cat "$PIDFILE")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  # The pid must still be our server, not a recycled pid.
  ps -p "$pid" -o command= 2>/dev/null | grep -q '.output/server/index.mjs' || return 1
  echo "$pid"
}

wait_up() {
  i=0
  while [ "$i" -lt "${1:-30}" ]; do
    if answers; then return 0; fi
    i=$((i + 1)); sleep 1
  done
  return 1
}

# ------------------------------------------------------------------ build
cmd_build() {
  say "wherdr plugin: preparing $DIR"
  mkdir -p "$DIR"
  printf '%s\n' "$DIR" > "$ROOT/.wherdr-dir"

  if [ -z "$MODE" ]; then
    if docker_usable; then MODE=docker; else MODE=native; fi
  fi
  case "$MODE" in
    docker) docker_usable || die "WHERDR_MODE=docker, but Docker Compose v2 is not usable by $(id -un) on this system." ;;
    native) ;;
    *) die "WHERDR_MODE must be docker or native (got: $MODE)." ;;
  esac

  if [ "$MODE" = "docker" ]; then build_docker; else build_native; fi
  # Written last: a failed build keeps no half-made choice. Rewritten on each
  # install from the merged settings (environment over the previous file).
  write_conf
  ok "plugin.env written (mode: $MODE)"
  say "wherdr plugin ready. It starts with Herdr; or run the \"Start wherdr\" action."
}

write_conf() {
  {
    echo "# wherdr Herdr plugin settings (herdr-plugin.sh)."
    echo "# To switch mode, set WHERDR_MODE and run: herdr plugin install $SOURCE"
    echo "WHERDR_MODE=$MODE"
    echo "WHERDR_PORT=$PORT"
    echo "# Native mode: private HTTPS address (tailscale serve), for push notifications."
    echo "APP_URL=${APP_URL:-}"
    if [ "$MODE" = "native" ]; then
      echo "# Native mode: absolute path of the node (22+) or bun that runs wherdr."
      echo "WHERDR_RUNTIME=$RUNTIME"
    fi
  } > "$CONF"
}

build_native() {
  RUNTIME="$(find_runtime)" || die "$RUNTIME_HELP"
  case "$(basename "$RUNTIME")" in
    bun) die "Only Bun was found ($RUNTIME): building wherdr needs Node.js 22 with npm.
     Install it from https://nodejs.org, then install the plugin again." ;;
  esac
  ok "Runtime: $RUNTIME ($("$RUNTIME" --version 2>/dev/null))"
  bindir="$(dirname "$RUNTIME")"
  [ -x "$bindir/npm" ] || command -v npm >/dev/null 2>&1 || die "npm is missing (it comes with Node.js)."
  cd "$ROOT"
  PATH="$bindir:$PATH" npm ci --no-audit --no-fund
  PATH="$bindir:$PATH" npm run build
  ok "wherdr built in the plugin folder"
}

build_docker() {
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?')"
  stamp="$DIR/.compose-from-plugin"
  if [ ! -f "$DIR/docker-compose.yml" ]; then
    cp "$ROOT/docker-compose.yml" "$DIR/docker-compose.yml"
    cksum < "$DIR/docker-compose.yml" > "$stamp"
    ok "docker-compose.yml copied"
  elif cmp -s "$ROOT/docker-compose.yml" "$DIR/docker-compose.yml"; then
    ok "docker-compose.yml is up to date"
  elif [ -f "$stamp" ] && [ "$(cksum < "$DIR/docker-compose.yml")" = "$(cat "$stamp")" ]; then
    # Unchanged since the plugin wrote it: safe to refresh.
    cp "$ROOT/docker-compose.yml" "$DIR/docker-compose.yml"
    cksum < "$DIR/docker-compose.yml" > "$stamp"
    ok "docker-compose.yml updated"
  else
    warn "Keeping your edited docker-compose.yml (the new one is $ROOT/docker-compose.yml)."
  fi
  if [ ! -f "$DIR/.env" ]; then
    herdr="$(herdr_bin)"
    {
      echo "# wherdr settings, read by docker compose (see .env.example in the repository)."
      echo "HOST_HOME=$HOME"
      echo "PUID=$(id -u)"
      echo "PGID=$(id -g)"
      echo "PORT=$PORT"
      echo "# Private HTTPS address (tailscale serve), needed for push notifications."
      echo "APP_URL=${APP_URL:-http://localhost:$PORT/}"
      echo "TZ=${TZ:-UTC}"
      if [ "$herdr" != "$HOME/.local/bin/herdr" ]; then echo "HERDR_BIN=$herdr"; fi
    } > "$DIR/.env"
    ok ".env created"
  else
    ok ".env kept"
  fi
  compose pull --quiet || die "Could not pull the wherdr image. Check the network, then install the plugin again."
  ok "Image pulled"
}

# ------------------------------------------------------------------ start
cmd_start() {
  if answers; then
    say "wherdr: something already answers on port $PORT, nothing to start ($URL)."
    return 0
  fi
  case "$MODE" in
    docker) start_docker ;;
    native) start_native ;;
    *) die "wherdr plugin is not set up ($CONF is missing): install it again with herdr plugin install $SOURCE." ;;
  esac
  if [ "$MODE" = "native" ]; then return 0; fi
  if wait_up 45; then
    say "wherdr is running: $URL"
  else
    warn "wherdr does not answer on port $PORT yet. Log: $(log_hint)"
    exit 1
  fi
}

start_native() {
  [ -f "$ROOT/.output/server/index.mjs" ] || die "wherdr is not built in $ROOT: run the Update action."
  if pid="$(native_pid)"; then
    say "wherdr (pid $pid) is starting already."
    return 0
  fi
  if ! runtime_ok "$RUNTIME"; then
    saved="$RUNTIME"
    RUNTIME="$(find_runtime)" || die "${saved:+The saved runtime ($saved) is gone. }$RUNTIME_HELP"
    warn "${saved:+$saved is gone: }using $RUNTIME (saved in $CONF)."
    write_conf
  fi
  mkdir -p "$DIR/data"
  sock="${HERDR_SOCKET_PATH:-}"
  # A plugin started from a named Herdr session drives that session.
  session=""
  case "$sock" in */sessions/*/herdr.sock) session="$(basename "$(dirname "$sock")")" ;; esac
  launcher=""
  if command -v setsid >/dev/null 2>&1; then launcher="setsid"; fi
  touch "$LOGFILE"
  logstart="$(wc -l < "$LOGFILE")"
  (
    cd "$ROOT"
    HERDR_BIN="$(herdr_bin)"
    # The runtime's folder first: tools it starts find the same node.
    PATH="$(dirname "$RUNTIME"):$PATH"
    export PATH HOST=127.0.0.1 PORT DATA_DIR="$DIR/data" HERDR_BIN HERDR_WEB_SESSION="$session"
    if [ -n "$sock" ]; then export HERDR_SOCK="$sock"; fi
    if [ -n "${APP_URL:-}" ]; then export APP_URL; fi
    # Detached: Herdr's startup hook returns at once, the server outlives it.
    $launcher nohup "$RUNTIME" "$ROOT/.output/server/index.mjs" >>"$LOGFILE" 2>&1 </dev/null &
    echo $! > "$PIDFILE"
  )
  pid="$(cat "$PIDFILE")"
  # "started" only once the process is alive and the port answers.
  i=0
  while [ "$i" -lt 45 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PIDFILE"
      start_failed "wherdr exited at startup ($RUNTIME)."
    fi
    if answers; then
      ok "wherdr started (pid $pid, $RUNTIME, log $LOGFILE)"
      say "wherdr is running: $URL"
      return 0
    fi
    i=$((i + 1)); sleep 1
  done
  start_failed "wherdr (pid $pid) does not answer on port $PORT after 45 s."
}

start_failed() {
  {
    printf '  ✗ %s Last lines of %s:\n' "$1" "$LOGFILE"
    tail -n "+$((logstart + 1))" "$LOGFILE" | tail -n 15 | sed 's/^/    /'
  } >&2
  exit 1
}

start_docker() {
  [ -f "$DIR/docker-compose.yml" ] || die "$DIR/docker-compose.yml is missing: run the Update action."
  if ! container_ours; then
    say "wherdr: the \"$CONTAINER\" container belongs to $(container_dir); start it from there. Nothing done."
    exit 0
  fi
  # Created as this user first: Docker would create missing bind mounts as root.
  mkdir -p "$DIR/data" "$HOME/.config/herdr" "$HOME/.local/state/herdr/client" \
    "$HOME/.cache/herdr-web" "$HOME/.herdr-projects"
  compose up -d --remove-orphans
  ok "container started"
}

log_hint() {
  if [ "$MODE" = "docker" ]; then echo "cd $DIR && docker compose logs"; else echo "$LOGFILE"; fi
}

# ------------------------------------------------------------------- stop
cmd_stop() {
  case "$MODE" in
    native)
      if pid="$(native_pid)"; then
        kill "$pid"
        i=0
        while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 10 ]; do i=$((i + 1)); sleep 1; done
        rm -f "$PIDFILE"
        say "wherdr stopped (pid $pid)."
        return 0
      fi
      ;;
    docker)
      if [ -n "$(container_dir)" ] && container_ours; then
        compose stop
        say "wherdr stopped (container $CONTAINER)."
        return 0
      fi
      ;;
  esac
  if answers; then
    say "wherdr on port $PORT was not started by this plugin: left running."
  else
    say "wherdr is not running."
  fi
}

# ----------------------------------------------------------------- status
cmd_status() {
  say "Mode:    ${MODE:-not set up}"
  say "Folder:  $DIR"
  if answers; then say "Port:    $PORT answers ($URL)"; else say "Port:    $PORT free"; fi
  case "$MODE" in
    native)
      if pid="$(native_pid)"; then say "Process: pid $pid, started by the plugin"; else say "Process: none started by the plugin"; fi
      say "Log:     $LOGFILE"
      ;;
    docker)
      owner="$(container_dir)"
      if [ -z "$owner" ]; then say "Container: none"
      elif container_ours; then say "Container: $CONTAINER ($(docker inspect "$CONTAINER" --format '{{.State.Status}}' 2>/dev/null)), managed by the plugin"
      else say "Container: $CONTAINER, managed from $owner (left alone)"
      fi
      ;;
  esac
}

# ------------------------------------------------------------------- open
cmd_open() {
  if command -v open >/dev/null 2>&1 && [ "$(uname -s)" = "Darwin" ]; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then xdg-open "$URL" >/dev/null 2>&1 &
  fi
  say "$URL"
}

# ----------------------------------------------------------------- update
cmd_update() {
  case "$MODE" in
    docker)
      container_ours || die "The \"$CONTAINER\" container belongs to $(container_dir): update it from there."
      compose pull --quiet
      if [ "$(docker inspect "$CONTAINER" --format '{{.State.Running}}' 2>/dev/null)" = "true" ]; then
        compose up -d --remove-orphans
        say "wherdr updated and restarted."
      else
        say "wherdr image updated; it runs the new version at the next start."
      fi
      ;;
    native)
      say "wherdr runs from the plugin folder. To update it:"
      say "  herdr plugin install $SOURCE --yes"
      say "then run the \"Restart wherdr\" action."
      ;;
    *) die "wherdr plugin is not set up: install it again with herdr plugin install $SOURCE." ;;
  esac
}

# ------------------------------------------------------------------ phone
tailnet_name() {
  command -v tailscale >/dev/null 2>&1 || return 1
  # Self comes before Peer in `tailscale status --json`: the first DNSName is this machine.
  tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -n 1
}

cmd_phone() {
  say ""
  say "  WHERDR · PHONE SETUP"
  say ""
  if answers; then say "  ✓ wherdr answers on $URL"; else say "  ! wherdr is not running: run the \"Start wherdr\" action first."; fi
  name="$(tailnet_name || true)"
  say ""
  say "  Your phone needs a private HTTPS address (never the public Internet):"
  say "  1. Install Tailscale on this machine and your phone, HTTPS certificates enabled."
  say "  2. Run:  tailscale serve --bg --https=$PORT http://127.0.0.1:$PORT"
  if [ -n "$name" ]; then
    phone="https://$name:$PORT/"
    say "  3. Open  $phone  on the phone and add it to the home screen."
  else
    phone=""
    say "  3. Open  https://<machine>.<tailnet>.ts.net:$PORT/  on the phone, add it to the home screen."
  fi
  if [ "$MODE" = "docker" ]; then
    say "  4. Put that address in APP_URL in $DIR/.env, then run the Update action."
  else
    say "  4. Put that address in APP_URL in $CONF, then run the \"Restart wherdr\" action."
  fi
  say "  5. In the app: Settings → Enable notifications, then Security → Enable passkey lock."
  if [ -n "$phone" ]; then
    say ""
    if command -v qrencode >/dev/null 2>&1; then
      qrencode -t ANSIUTF8 -m 2 "$phone"
    else
      say "  (Install qrencode to show a QR code of $phone here.)"
    fi
  fi
  say ""
  say "  Guide: https://github.com/$SOURCE#install-the-app-on-your-phone"
  say ""
  if [ -t 0 ]; then
    printf '  Press Enter to close. '
    read -r _ || true
  fi
}

case "${1:-}" in
  build) cmd_build ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  open) cmd_open ;;
  update) cmd_update ;;
  phone) cmd_phone ;;
  *) die "usage: $0 build|start|stop|restart|status|open|update|phone" ;;
esac
