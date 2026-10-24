# Migrate a wherdr 1.x Docker install to wherdr 2.0

wherdr 2.0.0 has no Docker image: it runs natively, as your user, so the herdr-projects Board can act.
This guide moves a wherdr 1.x container to the native service. It keeps the port, the data
folder (passkeys, push subscriptions, phone address, settings) and therefore the address your
devices open.

**For an AI agent.** The user can say "read this file and migrate me". Run the steps in order,
on the machine where the `wherdr` container runs, as the user who runs Herdr (never with `sudo`
unless a step says so). Every step ends with a **Check**. When a check fails, stop, do not run
the next step, and report the output to the user. Run [Roll back](#roll-back) if the user asks,
or if wherdr no longer answers after step 4. Ask the user before deleting anything; this guide never deletes.

The 1.x in-app banner shows `docker compose pull && docker compose up -d` for 2.0. That
command cannot reach 2.0: the `wherdr:latest` image on GHCR stays on the last 1.x release.
Running it changes nothing. This guide is the way to 2.0.

## 0. Collect the facts

```sh
docker inspect wherdr --format '{{.State.Status}} {{.Config.Image}}'
OLD="$(docker inspect wherdr --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')"
DATA_SRC="$(docker inspect wherdr --format '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Source }}{{ end }}{{ end }}')"
PORT="$(docker inspect wherdr --format '{{ range .Config.Env }}{{ println . }}{{ end }}' | sed -n 's/^PORT=//p')"
echo "OLD=$OLD DATA_SRC=$DATA_SRC PORT=${PORT:-7683}"
curl -fsS "http://127.0.0.1:${PORT:-7683}/api/health"
herdr --version
grep -s WHERDR_MODE ~/wherdr/plugin.env
```

**Check:** the container exists (`running`), `OLD` and `DATA_SRC` are absolute paths, `DATA_SRC`
holds files (`ls -la "$DATA_SRC"`), and the health answer says `"name":"wherdr"` with a `1.x`
version. Herdr must be 0.9.1 or newer. Linux or macOS only.

If the container has another name, use that name in every command. Keep `OLD`, `DATA_SRC` and
`PORT` for the next steps; in a new shell, set them again with the same commands.
If `~/wherdr/plugin.env` says `WHERDR_MODE=docker`, the Herdr plugin started this container: that is
expected, the plugin switches to native at step 4.

If the user also runs herdr-projects 0.2 (the Project panel, `TASKS.md`, threads), stop here
and tell them. wherdr 2.0's Board needs herdr-projects 1.2.1 or later; they must follow
[the herdr-projects migration guide](herdr-projects-1x.md) as well, or stay on wherdr 1.3.4.

## 1. Back up

```sh
BACKUP=~/wherdr-docker-backup-$(date +%F-%H%M).tgz
tar czf "$BACKUP" -C "$DATA_SRC" . && tar czf "$BACKUP.compose.tgz" -C "$OLD" $(cd "$OLD" && ls -A | grep -E '^(\.env|docker-compose.*\.ya?ml)$')
docker inspect wherdr --format '{{.Image}}' > "$BACKUP.image"
tar tzf "$BACKUP" | head; tar tzf "$BACKUP.compose.tgz"; cat "$BACKUP.image"
```

**Check:** the first archive lists the data files (for example `./auth.json`, `./push.json`), the
second one lists `docker-compose.yml` (and `.env` when there is one), and the image file holds a
`sha256:` id. That image stays on the machine for the way back: do not prune it.

## 2. Keep the settings

```sh
cat "$OLD/.env" 2>/dev/null
```

Keep the lines the user set, which the native service reads too: `APP_URL`, `HOST_LABEL`,
`HERDR_WEB_SESSION`, `HERDR_WEB_MACHINES`, `HERDR_WEB_SELF_HOSTS`, `HERDR_WEB_ALLOWED_HOSTS`,
`WHERDR_TRUSTED_NETWORKS`, `WHERDR_UPDATE_CHECK`, `PASSKEY_USER`,
`AGENT_KINDS`, `TZ`. Drop the container's own: `PORT` (it becomes `WHERDR_PORT` at step 4),
`HOST_HOME`, `HOME`, `PUID`, `PGID`, `DATA_DIR`, `HERDR_BIN`, `WHERDR_IMAGE`,
`WHERDR_DOCKER_LOOPBACK_ONLY`, `WHERDR_TASKS_FROM_FILES`, `HERDR_WEB_HOST_OPEN_*`.
Show the user the kept lines before writing them at step 3.

**Check:** the user agrees with the list (it may be empty).

## 3. Stop the container and put the data in place

```sh
(cd "$OLD" && docker compose down)
docker ps -a --filter name='^wherdr$' --format '{{.Names}}'
curl -fsS --max-time 3 "http://127.0.0.1:${PORT:-7683}/api/health" || echo "port free"
```

**Check:** no container is listed and the last line says `port free`. `docker compose down`
removes the container only; its folder, data and image stay.

The native service reads `~/wherdr/data`. When `DATA_SRC` is already `~/wherdr/data` (installs
made by the 1.x installer or plugin), leave it. Otherwise copy it; the command refuses when the
target exists (then show the user what `~/wherdr/data` holds and ask):

```sh
mkdir -p ~/wherdr
[ "$(cd "$DATA_SRC" && pwd -P)" = "$(cd ~/wherdr 2>/dev/null && pwd -P)/data" ] || { [ ! -e ~/wherdr/data ] && cp -a "$DATA_SRC" ~/wherdr/data; }
find ~/wherdr/data ! -user "$(id -u)" | head
```

**Check:** `ls ~/wherdr/data` shows the same files as `DATA_SRC`, and `find` prints nothing. If it
lists files owned by someone else (the container ran with another `PUID`), ask the user to run
`sudo chown -R "$(id -un)" ~/wherdr/data`.

Write the settings kept at step 2, one `KEY=VALUE` per line, in `~/wherdr/wherdr.env` (add them
to the file if it exists; never overwrite other lines).

## 4. Install the native service

```sh
curl -fsSL https://wherdr.dev/install | WHERDR_PORT="${PORT:-7683}" sh
```

The installer asks before installing Node.js 22 when it is missing; let the user answer
(`WHERDR_YES=1` answers yes to everything). It installs the Herdr plugin into `~/wherdr`, starts
wherdr on that port and installs its login service: `systemd --user` (`wherdr.service`) on Linux,
a LaunchAgent (`dev.wherdr.plist`) on macOS. A plugin left in Docker mode says
`switching this plugin to the native service`.

**Check:** the installer ends without an error and prints the wherdr address.

## 5. Verify

```sh
curl -fsS "http://127.0.0.1:${PORT:-7683}/api/health"
grep -s WHERDR_MODE ~/wherdr/plugin.env || echo "no Docker mode"
systemctl --user is-active wherdr 2>/dev/null || launchctl list 2>/dev/null | grep dev.wherdr
docker ps -a --filter name='^wherdr$' --format '{{.Names}}'
```

**Check:** health says `"name":"wherdr"` with a `2.x` version; `no Docker mode`; the service is
`active` (Linux) or listed (macOS); no container came back. If wherdr was reached over Tailscale,
`tailscale serve status` still points to the same port.

Then ask the user to open wherdr at the address they used before, on the phone and on each
browser. It must unlock with the same passkey, and notifications must still arrive. Each browser
copies its display settings to the server once, at its first visit (they are then shared).
If something fails here, go to [Roll back](#roll-back).

Leave the backup, the old compose folder and the image in place for a few days. Remove them later
only when the user asks (`docker image rm <id from $BACKUP.image>`).

## Roll back

Back to the 1.x container, with the data as it is now:

```sh
herdr plugin disable afloury.wherdr
systemctl --user disable --now wherdr 2>/dev/null || launchctl bootout "gui/$(id -u)/dev.wherdr" 2>/dev/null
curl -fsS --max-time 3 "http://127.0.0.1:${PORT:-7683}/api/health" || echo "port free"
```

When the data was copied at step 3, copy back what changed since (skip this when `DATA_SRC` is
`~/wherdr/data`): `cp -a ~/wherdr/data/. "$DATA_SRC/"`. To return to the data as it was before
the migration instead, restore the backup: `tar xzf "$BACKUP" -C "$DATA_SRC"`.

```sh
(cd "$OLD" && docker compose up -d)
curl -fsS "http://127.0.0.1:${PORT:-7683}/api/health"
```

**Check:** `port free` before starting, then health answers with the `1.x` version. If
`docker compose up` pulls a different image, pin the saved one: `WHERDR_IMAGE=<id from $BACKUP.image>`
in `"$OLD/.env"`, then run it again.

To stop the 1.x banner from offering 2.0, set `WHERDR_UPDATE_CHECK=off` in `"$OLD/.env"` and run
`docker compose up -d` again.
