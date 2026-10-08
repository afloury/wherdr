#!/bin/sh
# wherdr as a Herdr plugin (herdr-plugin.toml): build (install + first start),
# the panel, start, stop, status, open, update, service, skill, key.
#
#   herdr plugin install <owner>/wherdr
#
# Two ways to run wherdr, picked once at install time and kept in
# $WHERDR_DIR/plugin.env:
#   docker  Linux with Docker Compose v2 usable by this user: the published
#           image, run from $WHERDR_DIR exactly like https://wherdr.dev/install.
#   native  everywhere else (always on macOS: Docker Desktop cannot reach
#           Herdr's Unix socket): Node.js 22 (or Bun) runs the prebuilt npm
#           package of this version (or a build made in the plugin folder),
#           copied to $WHERDR_DIR/app and started detached from there, with
#           its pid and log in $WHERDR_DIR.
# Herdr builds a plugin in a temporary folder, then moves it: a server started
# from the checkout during the build would lose its files. $WHERDR_DIR/app
# stays put, across plugin updates too, so the build can start wherdr and a
# login service can point at it.
# WHERDR_MODE=native (or docker) in the environment of `herdr plugin install`
# forces the choice; edit plugin.env to change it later, then run Update.
#
# Safety rules:
#   - nothing global is installed, no sudo; files are only written to the
#     plugin folder and $WHERDR_DIR (default ~/wherdr), plus the folders the
#     Docker setup mounts (~/.config/herdr, ~/.cache/herdr-web…), and the
#     login service only when asked (key A of the panel), plus a "wherdr"
#     link in the agents' user skill folders (see cmd_skill), plus one marked
#     block appended to Herdr's config.toml: the key that opens the panel
#     (see cmd_key);
#   - the install starts wherdr, and Herdr's startup hook starts it again,
#     but only when nothing answers on the port: a wherdr started another way
#     (Docker, systemd, by hand) is never touched, no second wherdr is started;
#   - stop only stops what this plugin started (its pid, its login service, or
#     the container of its own compose folder).
#
# Uninstall: Herdr has no uninstall hook. Stop wherdr (and remove the login
# service) from the panel first, then:
#   sh scripts/herdr-plugin.sh skill uninstall   (in the plugin folder)
#   sh scripts/herdr-plugin.sh key uninstall     (the Herdr key of the panel)
#   herdr plugin uninstall <owner>.wherdr && rm -rf ~/wherdr
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
# Native mode: the installed copy of wherdr (bin + built server).
APP="$DIR/app"
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

wait_up() {
  i=0
  while [ "$i" -lt "${1:-30}" ]; do
    if answers; then return 0; fi
    i=$((i + 1)); sleep 1
  done
  return 1
}

# The commands of the native mode: the installed copy, or the checkout itself
# (a linked plugin built by hand, or a plugin installed before $APP existed).
cli_root() {
  if [ -f "$APP/bin/wherdr.mjs" ] && [ -f "$APP/.output/server/index.mjs" ]; then echo "$APP"; else echo "$ROOT"; fi
}

# The person running `herdr plugin install` sees only Herdr's own lines: the
# output of build commands is captured. Important lines also go to the terminal.
tell() {
  printf '%s\n' "$*"
  { printf '%s\n' "$*" > /dev/tty; } 2>/dev/null || true
}

# ------------------------------------------------------------------ build
cmd_build() {
  tell "wherdr: installing in $DIR"
  # First install (no plugin.env yet): the browser opens on the setup guide
  # once wherdr runs. Updates keep plugin.env and open nothing.
  FIRST_INSTALL=0
  [ -f "$CONF" ] || FIRST_INSTALL=1
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
  ( cmd_skill install ) || warn "wherdr skill not linked (optional): run $0 skill install"
  ( cmd_key install ) || warn "no Herdr key for the panel (optional): run $0 key install"
  build_start
}

# ------------------------------------------------------------------ skill
# The "wherdr" agent skill (skills/wherdr/SKILL.md): the conventions of the
# Project panel for herdr-projects coordinators. Copied to $DIR/skills/wherdr
# (the checkout is built in a temporary folder, then moved), then linked into
# the user skill folders: Claude Code's ${CLAUDE_CONFIG_DIR:-~/.claude}/skills,
# and ~/.agents/skills, read by Codex and omp. Only links to that copy are
# ever created or removed: a "wherdr" skill of someone else is left alone.
SKILL_COPY="$DIR/skills/wherdr"

skill_dirs() {
  claude="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  [ -d "$claude" ] && echo "$claude/skills"
  if [ -d "$HOME/.agents" ] || [ -d "$HOME/.codex" ] || [ -d "$HOME/.omp" ]; then echo "$HOME/.agents/skills"; fi
  return 0
}

cmd_skill() {
  case "${1:-}" in
    install)
      mkdir -p "$SKILL_COPY"
      cp "$ROOT/skills/wherdr/SKILL.md" "$SKILL_COPY/SKILL.md"
      skill_dirs | while IFS= read -r d; do
        link="$d/wherdr"
        if [ -L "$link" ] && [ "$(readlink "$link")" = "$SKILL_COPY" ]; then ok "skill already linked: $link"
        elif [ -e "$link" ] || [ -L "$link" ]; then warn "skill not linked: $link already exists (left alone)"
        else mkdir -p "$d" && ln -s "$SKILL_COPY" "$link" && ok "skill linked: $link"
        fi
      done
      ;;
    uninstall)
      skill_dirs | while IFS= read -r d; do
        link="$d/wherdr"
        if [ -L "$link" ] && [ "$(readlink "$link")" = "$SKILL_COPY" ]; then rm "$link" && ok "skill unlinked: $link"; fi
      done
      rm -rf "$SKILL_COPY"
      rmdir "$DIR/skills" 2>/dev/null || true
      ;;
    *) die "usage: $0 skill install|uninstall" ;;
  esac
}

# Last step of the install: start wherdr (or restart the one this plugin
# runs, on an update). Never fails the install: a wherdr that cannot start is
# reported with what to do, the plugin stays installed.
build_start() {
  set +e
  out="$( (cmd_start) 2>&1 )"
  code=$?
  set -e
  printf '%s\n' "$out"
  if [ "$code" -eq 0 ] && answers; then
    # https://wherdr.dev/install prints its own summary (WHERDR_INSTALLER=1).
    quiet=0
    [ "${WHERDR_INSTALLER:-0}" = 1 ] && quiet=1
    [ "$quiet" = 1 ] || tell ""
    [ "$quiet" = 1 ] || tell "✓ wherdr is running → $URL"
    if [ "${FIRST_INSTALL:-0}" = 1 ]; then
      if open_browser "$URL/#/setup"; then [ "$quiet" = 1 ] || tell "  Setup guide opened in your browser"
      else [ "$quiet" = 1 ] || tell "  Setup guide: open $URL/#/setup in a browser on this computer"
      fi
    fi
    [ "$quiet" = 1 ] || tell "  Phone: open the wherdr panel in Herdr (key above, or herdr plugin action invoke panel --plugin $PLUGIN_ID)"
  else
    tell ""
    tell "! wherdr is installed but did not start:"
    printf '%s\n' "$out" | tail -n 8 | while IFS= read -r l; do tell "    $l"; done
    tell "  Open the wherdr panel in Herdr, then press S to start it or L for its log."
  fi
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

# The published npm package of this exact version holds the built server:
# download it instead of building (no npm ci). Fails when it is not published.
fetch_prebuilt() {
  command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || return 1
  version="$(sed -n 's/^version = "\(.*\)"$/\1/p' "$ROOT/herdr-plugin.toml" | head -n 1)"
  tmp="$(mktemp -d)"
  if curl -fsSL --max-time 120 "https://registry.npmjs.org/wherdr/-/wherdr-$version.tgz" -o "$tmp/wherdr.tgz" 2>/dev/null \
    && tar -xzf "$tmp/wherdr.tgz" -C "$tmp" \
    && [ -f "$tmp/package/.output/server/index.mjs" ]; then
    rm -rf "$ROOT/.output"
    mv "$tmp/package/.output" "$ROOT/.output"
    rm -rf "$tmp"
    ok "wherdr $version downloaded (prebuilt npm package)"
    return 0
  fi
  rm -rf "$tmp"
  return 1
}

# qrcode-terminal (the panel's QR code), the only package the commands need
# at runtime, when the folder does not have it yet (no npm ci was run).
fetch_qr() {
  [ -f "$1/node_modules/qrcode-terminal/package.json" ] && return 0
  command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || return 0
  tmp="$(mktemp -d)"
  if curl -fsSL --max-time 60 https://registry.npmjs.org/qrcode-terminal/-/qrcode-terminal-0.12.0.tgz -o "$tmp/qr.tgz" 2>/dev/null \
    && tar -xzf "$tmp/qr.tgz" -C "$tmp"; then
    mkdir -p "$1/node_modules"
    rm -rf "$1/node_modules/qrcode-terminal"
    mv "$tmp/package" "$1/node_modules/qrcode-terminal"
  else
    warn "No QR code in the panel (qrcode-terminal could not be downloaded)."
  fi
  rm -rf "$tmp"
}

build_native() {
  RUNTIME="$(find_runtime)" || die "$RUNTIME_HELP"
  ok "Runtime: $RUNTIME ($("$RUNTIME" --version 2>/dev/null))"
  if fetch_prebuilt; then
    install_app
    return 0
  fi
  case "$(basename "$RUNTIME")" in
    bun) die "The prebuilt wherdr package could not be downloaded, and building it needs Node.js 22 with npm.
     Check the network, or install Node.js 22, then install the plugin again." ;;
  esac
  bindir="$(dirname "$RUNTIME")"
  [ -x "$bindir/npm" ] || command -v npm >/dev/null 2>&1 || die "npm is missing (it comes with Node.js)."
  tell "wherdr: building (a few minutes the first time)…"
  (
    cd "$ROOT"
    PATH="$bindir:$PATH" npm ci --no-audit --no-fund
    PATH="$bindir:$PATH" npm run build
  )
  ok "wherdr built in the plugin folder"
  install_app
}

# Copies the commands and the built server to $APP, which outlives this
# checkout. A wherdr this plugin runs from the previous copy is stopped for
# the swap; build_start starts the new one.
install_app() {
  # Nitro links some packages (tslib) to its own folder: copies, not links.
  if [ -d "$ROOT/.output/server/node_modules" ]; then "$RUNTIME" "$ROOT/scripts/pack-output.mjs" >/dev/null; fi
  new="$APP.new"
  rm -rf "$new"
  mkdir -p "$new"
  cp -R "$ROOT/bin" "$ROOT/.output" "$ROOT/package.json" "$new/"
  if [ -d "$ROOT/node_modules/qrcode-terminal" ]; then
    mkdir -p "$new/node_modules"
    cp -R "$ROOT/node_modules/qrcode-terminal" "$new/node_modules/"
  fi
  fetch_qr "$new"
  # The wherdr this plugin runs (from the previous copy, or from an older
  # plugin checkout): stopped for the swap, started again by build_start.
  if [ -f "$DIR/wherdr.pid" ] || [ -f "$APP/bin/wherdr.mjs" ]; then cli stop >/dev/null 2>&1 || true; fi
  rm -rf "$APP.old"
  if [ -d "$APP" ]; then mv "$APP" "$APP.old"; fi
  mv "$new" "$APP"
  rm -rf "$APP.old"
  ok "wherdr $(sed -n 's/^ *"version": *"\(.*\)",$/\1/p' "$APP/package.json" | head -n 1) installed in $APP"
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
  # The panel runs from the checkout with node when there is one.
  fetch_qr "$ROOT"
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

# Native mode: the wherdr command (bin/wherdr.mjs) does the work, with the
# runtime saved at install; it says "started" only once the port answers.
ensure_runtime() {
  if ! runtime_ok "$RUNTIME"; then
    saved="$RUNTIME"
    RUNTIME="$(find_runtime)" || die "${saved:+The saved runtime ($saved) is gone. }$RUNTIME_HELP"
    warn "${saved:+$saved is gone: }using $RUNTIME (saved in $CONF)."
    write_conf
  fi
}

cli() {
  ensure_runtime
  sock="${HERDR_SOCKET_PATH:-}"
  # A plugin started from a named Herdr session drives that session.
  session=""
  case "$sock" in */sessions/*/herdr.sock) session="$(basename "$(dirname "$sock")")" ;; esac
  (
    cd "$DIR"
    HERDR_BIN="$(herdr_bin)"
    # The runtime's folder first: tools it starts find the same node.
    PATH="$(dirname "$RUNTIME"):$PATH"
    export PATH WHERDR_DIR="$DIR" WHERDR_RUNTIME="$RUNTIME" HOST=127.0.0.1 PORT HERDR_BIN
    if [ -n "$session" ]; then export HERDR_WEB_SESSION="$session"; fi
    if [ -n "$sock" ]; then export HERDR_SOCK="$sock"; fi
    if [ -n "${APP_URL:-}" ]; then export APP_URL; fi
    exec "$RUNTIME" "$(cli_root)/bin/wherdr.mjs" "$@"
  )
}

start_native() {
  [ -f "$(cli_root)/.output/server/index.mjs" ] || die "wherdr is not built: install the plugin again (herdr plugin install $SOURCE --yes)."
  mkdir -p "$DIR"
  cli start
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

log_hint() { echo "cd $DIR && docker compose logs"; }

# ------------------------------------------------------------------- stop
cmd_stop() {
  case "$MODE" in
    native) cli stop; return 0 ;;
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
  if [ "$MODE" = "native" ]; then
    cli status
    say "  Plugin   native mode, settings in $CONF"
    return 0
  fi
  say "Mode:    ${MODE:-not set up}"
  say "Folder:  $DIR"
  if answers; then say "Port:    $PORT answers ($URL)"; else say "Port:    $PORT free"; fi
  if [ "$MODE" = "docker" ]; then
    owner="$(container_dir)"
    if [ -z "$owner" ]; then say "Container: none"
    elif container_ours; then say "Container: $CONTAINER ($(docker inspect "$CONTAINER" --format '{{.State.Status}}' 2>/dev/null)), managed by the plugin"
    else say "Container: $CONTAINER, managed from $owner (left alone)"
    fi
  fi
}

# ------------------------------------------------------------- logs, doctor
cmd_logs() {
  case "$MODE" in
    native) cli logs --follow ;;
    docker) compose logs --follow --tail 100 ;;
    *) die "wherdr plugin is not set up: install it again with herdr plugin install $SOURCE." ;;
  esac
}

cmd_doctor() {
  if [ "$MODE" = "native" ]; then cli doctor; else cmd_status; fi
}

# ------------------------------------------------------------------- open
# The default browser, on a computer with a screen only: `open` on macOS,
# `xdg-open` on Linux with a display. Fails (opens nothing) on a headless server,
# or with WHERDR_NO_BROWSER=1 (set by https://wherdr.dev/install over SSH).
open_browser() {
  if [ "${WHERDR_NO_BROWSER:-0}" = "1" ]; then return 1
  elif [ "$(uname -s)" = "Darwin" ] && command -v open >/dev/null 2>&1; then open "$1"
  elif [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 &
  else return 1
  fi
}

cmd_open() {
  open_browser "$URL" || true
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
      # A new checkout, a new copy in $APP, and wherdr restarted (build_start).
      say "Updating the wherdr plugin from $SOURCE…"
      "$(herdr_bin)" plugin install "$SOURCE" --yes
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

# The phone setup is a page of the app (Settings › Phone); `wherdr phone`
# prints the state and its link. Docker without Node.js: the steps by hand.
cmd_phone() {
  if [ "$MODE" = "native" ]; then cli phone; return 0; fi
  say ""
  say "  WHERDR · PHONE SETUP"
  say ""
  if answers; then say "  ✓ wherdr answers on $URL"; else say "  ! wherdr is not running: press S in the wherdr panel first."; fi
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
  say "  4. Then open $URL/#/settings?section=phone: wherdr checks the address and sets APP_URL itself."
  say "  5. In the app: Settings → Enable notifications, then Security → Enable passkey lock."
  # The QR code only for an address that answers like wherdr.
  if [ -n "$phone" ] && command -v curl >/dev/null 2>&1 \
    && curl -fsS --max-time 8 "${phone}manifest.webmanifest" 2>/dev/null | grep -q wherdr; then
    say ""
    if command -v qrencode >/dev/null 2>&1; then
      qrencode -t ANSIUTF8 -m 2 "$phone"
    else
      say "  (Install qrencode to show a QR code of $phone here.)"
    fi
  elif [ -n "$phone" ]; then
    say ""
    say "  ! Not reachable from your phone yet: $phone does not answer (step 2)."
  fi
  say ""
  say "  Guide: https://github.com/$SOURCE#install-it-as-an-app"
}

# ------------------------------------------------------------------ service
cmd_service() {
  case "${1:-}" in install|uninstall) ;; *) die "usage: $0 service install|uninstall" ;; esac
  if [ "$MODE" = "docker" ]; then
    say "wherdr runs in Docker: the container already starts with Docker (restart: always)."
    return 0
  fi
  cli service "$1"
  # Without the service, the plugin runs wherdr again (and its startup hook
  # starts it with Herdr).
  if [ "$1" = "uninstall" ]; then cmd_start; fi
}

# ------------------------------------------------------------------ key
# A Herdr key that opens the wherdr panel: Herdr v1 plugins have no menu, so
# the install appends one marked [[keys.command]] block to Herdr's
# config.toml, on the first free key of HOTKEYS (never one Herdr or the user
# already binds). Existing lines are never changed: the block is only ever
# appended, then removed by `key uninstall`. Nothing is added when the panel
# already has a key, or when no candidate is free.
HOTKEYS="${WHERDR_HOTKEYS:-prefix+i prefix+u prefix+y prefix+m prefix+alt+w}"
HERDR_CONFIG="${HERDR_CONFIG_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr/config.toml}"
PLUGIN_ID="$(printf '%s' "$SOURCE" | tr / .)"
PANEL_ACTION="$PLUGIN_ID.panel"
KEY_BEGIN="# wherdr: key that opens the wherdr panel (remove this block to unbind it)"
KEY_END="# end wherdr"

# Herdr's default keymap, from the running binary when it can print it,
# otherwise as of Herdr 0.9.3 ("name<TAB>key" lines).
default_keys() {
  out="$("$(herdr_bin)" --default-config 2>/dev/null | awk '
    /^\[keys\]/ { k = 1; next }
    k && /^\[/ { exit }
    k && match($0, /^# [a-z_]+ = "[^"]*"/) {
      line = substr($0, 3, RLENGTH - 2); eq = index(line, " = ")
      v = substr(line, eq + 4); sub(/"$/, "", v)
      if (v != "") printf "%s\t%s\n", substr(line, 1, eq - 1), v
    }')" || out=""
  if [ -n "$out" ]; then printf '%s\n' "$out"; return; fi
  for p in help:? settings:s detach:q reload_config:shift+r open_notification_target:o \
    workspace_picker:w goto:g new_workspace:shift+n new_worktree:shift+g rename_workspace:shift+w \
    close_workspace:shift+d new_tab:c rename_tab:shift+t previous_tab:p next_tab:n \
    close_tab:shift+x rename_pane:shift+p edit_scrollback:e focus_pane_left:h focus_pane_down:j \
    focus_pane_up:k focus_pane_right:l cycle_pane_next:tab cycle_pane_previous:shift+tab \
    split_vertical:v split_horizontal:minus close_pane:x zoom:z resize_mode:r toggle_sidebar:b; do
    printf '%s\tprefix+%s\n' "${p%%:*}" "${p#*:}"
  done
}

# One line on the config: "bound <key>" when a [[keys.command]] already runs
# the panel, else "free <key>" (first free candidate) or "none". Also
# "old <key>" for a binding of the panel's former action id (<id>.wherdr).
key_scan() {
  defaults="$(default_keys)"
  { printf '%s\n' "$defaults"; printf '\001\n'; cat "$HERDR_CONFIG" 2>/dev/null; } | awk \
    -v cands="$HOTKEYS" -v action="$PANEL_ACTION" -v old="$PLUGIN_ID.wherdr" '
    function norm(k) {
      gsub(/[ \t]/, "", k)
      # "prefix+W" is "prefix+shift+w"
      if (match(k, /\+[A-Z]$/)) k = substr(k, 1, RSTART) "shift+" tolower(substr(k, RSTART + 1))
      return tolower(k)
    }
    function strings(s, out,   n) {
      n = 0
      while (match(s, /"[^"]*"/)) { out[++n] = substr(s, RSTART + 1, RLENGTH - 2); s = substr(s, RSTART + RLENGTH) }
      return n
    }
    function flush() {
      if (ckey != "" && cmd == action && bound == "") bound = ckey
      if (ckey != "" && cmd == old && oldkey == "") oldkey = ckey
      ckey = ""; cmd = ""
    }
    $0 == "\001" { conf = 1; next }
    !conf { split($0, d, "\t"); def[d[1]] = d[2]; next }
    /^[ \t]*\[/ {
      flush(); t = $0; sub(/#.*/, "", t); gsub(/[ \t]/, "", t)
      sect = t == "[keys]" ? "keys" : t == "[[keys.command]]" ? "cmd" : ""
      next
    }
    /^[ \t]*(#|$)/ { next }
    {
      eq = index($0, "="); if (!eq) next
      name = substr($0, 1, eq - 1); gsub(/[ \t]/, "", name); val = substr($0, eq + 1)
      if (sect == "keys") {
        over[name] = 1; n = strings(val, s)
        for (i = 1; i <= n; i++) taken[norm(s[i])] = 1
      } else if (sect == "cmd" && strings(val, s)) {
        if (name == "key") { ckey = s[1]; taken[norm(s[1])] = 1 }
        if (name == "command") cmd = s[1]
      }
    }
    END {
      flush()
      if (oldkey != "") print "old " oldkey
      if (bound != "") { print "bound " bound; exit }
      for (a in def) if (!(a in over)) taken[norm(def[a])] = 1
      n = split(cands, c, " ")
      for (i = 1; i <= n; i++) if (!(norm(c[i]) in taken)) { print "free " c[i]; exit }
      print "none"
    }'
}

# The key bound to the panel, if any.
key_bound() { key_scan | sed -n 's/^bound //p'; }

# Herdr applies keybindings on `herdr server reload-config` (no restart).
key_reload() {
  if "$(herdr_bin)" server reload-config >/dev/null 2>&1; then
    tell "  Herdr reloaded its config: no restart needed."
  else
    tell "  Run herdr server reload-config (or restart Herdr) to apply it."
  fi
}

cmd_key() {
  case "${1:-}" in
    install)
      scan="$(key_scan)"
      old="$(printf '%s\n' "$scan" | sed -n 's/^old //p')"
      [ -z "$old" ] || warn "$old runs $PLUGIN_ID.wherdr, renamed $PANEL_ACTION: edit that line of $HERDR_CONFIG."
      res="$(printf '%s\n' "$scan" | sed '/^old /d')"
      case "$res" in
        bound\ *) tell "Press ${res#bound } in Herdr to open the wherdr panel." ;;
        free\ *)
          key="${res#free }"
          mkdir -p "$(dirname "$HERDR_CONFIG")"
          block="$(printf '%s\n[[keys.command]]\nkey = "%s"\ntype = "plugin_action"\ncommand = "%s"\ndescription = "wherdr"\n%s' \
            "$KEY_BEGIN" "$key" "$PANEL_ACTION" "$KEY_END")"
          sep=""
          if [ -s "$HERDR_CONFIG" ]; then
            sep="
"
            # A last line without its newline gets one first.
            [ "$(tail -c 1 "$HERDR_CONFIG" | od -An -c | tr -d ' ')" = '\n' ] || sep="
$sep"
          fi
          # Checked on a copy first when this Herdr can validate a config:
          # a config Herdr would reject is never written.
          tmp="$HERDR_CONFIG.wherdr-check.toml"
          { if [ -f "$HERDR_CONFIG" ]; then cat "$HERDR_CONFIG"; fi; printf '%s%s\n' "$sep" "$block"; } > "$tmp"
          if "$(herdr_bin)" config --help >/dev/null 2>&1 && ! HERDR_CONFIG_PATH="$tmp" "$(herdr_bin)" config check >/dev/null 2>&1; then
            rm -f "$tmp"
            warn "no Herdr key added: $HERDR_CONFIG would not validate with it (herdr config check)."
            return 0
          fi
          rm -f "$tmp"
          printf '%s%s\n' "$sep" "$block" >> "$HERDR_CONFIG"
          ok "Herdr key $key added to $HERDR_CONFIG"
          tell "Press $key in Herdr to open the wherdr panel."
          key_reload
          ;;
        *) warn "no Herdr key added: $HOTKEYS are all taken. Bind one to $PANEL_ACTION (type = \"plugin_action\") in $HERDR_CONFIG." ;;
      esac
      ;;
    uninstall)
      if ! grep -qxF "$KEY_BEGIN" "$HERDR_CONFIG" 2>/dev/null; then ok "no wherdr key in $HERDR_CONFIG"; return 0; fi
      # Drops the marked block and the blank line written before it.
      tmp="$HERDR_CONFIG.wherdr-tmp"
      awk -v b="$KEY_BEGIN" -v e="$KEY_END" '
        $0 == b { skip = 1; if (blank) blank--; next }
        skip { if ($0 == e) skip = 0; next }
        $0 == "" { blank++; next }
        { while (blank) { print ""; blank-- } print }
        END { while (blank) { print ""; blank-- } }' "$HERDR_CONFIG" > "$tmp"
      # Rewritten in place: the file keeps its owner and mode.
      cat "$tmp" > "$HERDR_CONFIG" && rm -f "$tmp"
      ok "wherdr key removed from $HERDR_CONFIG"
      key_reload
      ;;
    status) b="$(key_bound)"; if [ -n "$b" ]; then say "$b"; else say "none"; fi ;;
    *) die "usage: $0 key install|uninstall|status" ;;
  esac
}

# ------------------------------------------------------------------ panel
# The "panel" action: one popup with the state, Open wherdr, Set up my phone
# (opens Settings › Phone) and the other commands (bin/lib/panel.mjs),
# driving this script.
cmd_panel() {
  control="$(printf '["sh","%s"]' "$(printf '%s' "$ROOT/scripts/herdr-plugin.sh" | sed 's/[\\"]/\\&/g')")"
  if [ "$MODE" = "native" ] || { [ -n "$MODE" ] && RUNTIME="$(find_runtime)"; }; then
    WHERDR_CONTROL="$control" WHERDR_MODE="$MODE" WHERDR_HOTKEY="$(key_bound)" cli panel
  elif [ -n "$MODE" ]; then
    sh_panel
  else
    die "wherdr plugin is not set up ($CONF is missing): install it again with herdr plugin install $SOURCE --yes."
  fi
}

# Docker mode without Node.js: the same keys, without the QR code.
sh_panel() {
  saved="$(stty -g)"
  trap 'stty "$saved"' EXIT
  while :; do
    printf '\033[H\033[2J\n  WHERDR\n\n'
    ( cmd_status ) || true
    printf '\n  S start  X stop  R restart  O open  L log  U update  P phone  Q quit\n'
    printf '  Remove: X, then sh %s key uninstall, then herdr plugin uninstall %s && rm -rf %s\n' "$ROOT/scripts/herdr-plugin.sh" "$PLUGIN_ID" "$DIR"
    stty -icanon -echo min 0 time 50
    k="$(dd bs=1 count=1 2>/dev/null || true)"
    stty "$saved"
    case "$k" in
      s|S) act=start ;; x|X) act=stop ;; r|R) act=restart ;; o|O) act=open ;;
      l|L) act=logs ;; u|U) act=update ;; p|P) act=phone ;; q|Q) break ;;
      *) continue ;;
    esac
    printf '\033[H\033[2J\n'
    ( trap - INT; "cmd_$act" ) || true
    printf '\n  Press Enter to go back. '
    read -r _ || true
  done
}

cmd_restart() { cmd_stop; cmd_start; }

case "${1:-}" in
  build) cmd_build ;;
  panel) cmd_panel ;;
  start|stop|restart|status|open|update|phone|logs|doctor) "cmd_$1" ;;
  service) cmd_service "${2:-}" ;;
  skill) cmd_skill "${2:-}" ;;
  key) cmd_key "${2:-}" ;;
  *) die "usage: $0 build|panel|start|stop|restart|status|open|update|phone|logs|doctor|service install|uninstall|skill install|uninstall|key install|uninstall|status" ;;
esac
