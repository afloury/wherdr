# Setting up wherdr — a guide for coding agents

You are a coding agent (Claude Code, Codex, omp…) helping your user install **wherdr**: a
self-hosted web app and phone PWA to follow and drive the coding agents running in
[Herdr](https://herdr.dev). Follow this guide; for details, read the README:
https://github.com/afloury/wherdr#readme (raw: https://raw.githubusercontent.com/afloury/wherdr/main/README.md).

wherdr runs **on one machine, where Herdr runs** (the "wherdr machine"), as the user who runs
Herdr. It listens on `127.0.0.1:7683` only. It is a remote shell on that machine: whoever reaches
it can run commands as that user. Other computers with agents only need Herdr: wherdr reaches
them over SSH (see [D](#d-several-machines)). Never install wherdr on more than one machine.

**Where you run commands.** Every command below runs on the wherdr machine. If you are not
running on it yourself (for example you run on the user's laptop and wherdr goes on a Raspberry
Pi), do not improvise remote access: either ask the user to start you (or another agent) on that
machine, or give them each command to paste into a terminal there (over `ssh`), one at a time,
and ask for the output.

## Rules (non-negotiable)

1. **Never expose wherdr on the Internet.** No port forwarding, no public reverse proxy, no
   Cloudflare Tunnel, no ngrok, no `tailscale funnel`. For other devices, use only
   `tailscale serve` (private to the user's tailnet). If the user asks for public access,
   refuse and explain why.
2. **Ask before** installing Docker, Tailscale, Node.js or Git, and before any `sudo` command.
   Show the command, say what it does, wait for a yes.
3. **Do not touch the user's agent configuration** (`~/.claude`, `~/.codex`, Herdr's config) and
   do not read credential files. wherdr itself never changes them.
4. Run everything **as the user who runs Herdr**, never as root.
5. **Passkey lock**: as soon as the app is reachable from another device (phone, other
   computer), turn it on (Settings → Security → Enable passkey lock) before anything else. The
   README calls it optional; treat it as required unless the user explicitly declines.
6. One step at a time: run it, check it (see each step's **Check**), then go on. If a check
   fails, see [Troubleshooting](#troubleshooting) before trying anything else.

## 1. Ask first

Ask these one at a time, in plain words. Skip a question when you can find the answer yourself
(`uname -s`, `herdr --version`, `herdr status server`).

1. **Phone or this computer only?** "Do you want to follow your agents from your phone, or only
   in a browser on this computer?"
2. **Always-on machine?** (only if phone) "Do you have a machine that stays on all the time —
   a Raspberry Pi, a mini-PC, a home server, a private VPS — running Linux? If not, this
   computer must stay awake for your phone to reach wherdr." If yes, that machine is the wherdr
   machine; the agents can run there too.
3. **Linux or macOS?** for the wherdr machine.
4. **One machine or several?** "Do you run (or want to run) coding agents on more than one
   computer — for example on the server and on your laptop?" The others come last, in D.
5. **Is Herdr installed and running on the wherdr machine?** `herdr --version` must print
   **Herdr ≥ 0.9.1**; `herdr status server` tells whether its server runs.

Then pick the path:

| Answers | Path |
| --- | --- |
| This computer only, macOS | [A. macOS, no Docker](#a-macos-no-docker) |
| This computer only, Linux | [B. Linux with Docker](#b-linux-with-docker) (or A if the user prefers Node.js) |
| Phone, always-on Linux machine | [B](#b-linux-with-docker) on that machine, then [C. Phone over Tailscale](#c-phone-over-tailscale) |
| Phone, no always-on machine, macOS | [A](#a-macos-no-docker), then [C](#c-phone-over-tailscale) (works only while the Mac is awake) |
| Phone, no always-on machine, Linux | [B](#b-linux-with-docker), then [C](#c-phone-over-tailscale) (works only while the computer is awake) |
| Several machines | One of the above on **one** machine (the always-on one if any), then [D. Several machines](#d-several-machines) |

Do not mention Tailscale or phones to a user who only wants this computer: skip C.

## 2. Herdr first

Before installing wherdr, Herdr ≥ 0.9.1 must be installed on the wherdr machine **and its server
running** (`herdr` in a terminal, or `herdr server`); wherdr connects to it, and the installer
checks it. If Herdr is missing or older, send the user to https://herdr.dev to install or update
it (`herdr update`); do not guess an install command.

Then install the integrations of the agents the user uses, on every machine that runs agents
(`herdr integration install claude|codex|omp`). Without them wherdr shows only the terminal of
those agents, not the conversation; agents started before need a restart.

## A. macOS, no Docker

Docker Desktop cannot reach Herdr's Unix socket on macOS, so wherdr runs natively there (this
also works on Linux). Needs Git and Node.js 22: check `git --version` and `node --version`. If
one is missing, ask, then propose the official installer (https://nodejs.org) or Homebrew if the
user already has it; on macOS, `git` comes with the Xcode command line tools.

```sh
git clone https://github.com/afloury/wherdr.git && cd wherdr
npm ci && npm run build && npm start    # then open http://localhost:7683
```

`npm start` stays in the foreground: wherdr stops when that terminal closes or on Ctrl+C. Fine
for a first try. To keep it running, ask the user: leave a terminal open, or a background
service (on macOS a launchd user agent running `npm start` in the clone, on Linux a systemd user
unit). Write the service file only after they agree, and tell them how to stop it.

**Check:** `curl -fsS http://127.0.0.1:7683` returns HTML; the user opens
`http://localhost:7683` in a browser on that computer and sees their agents.

Update later: stop wherdr, `git pull && npm ci && npm run build`, then start it again.

## B. Linux with Docker

Needs Docker Engine with Compose v2 (`docker compose version`). If Docker is missing, ask before
installing it (https://docs.docker.com/engine/install/). If `docker info` fails with a
permission error, the user's account needs the `docker` group (the installer stops and says so):
that is a `sudo` command (`sudo usermod -aG docker $(id -un)`), so ask first; then the user must
log out and back in (or reboot) before running the installer again.

The one-line installer does the whole setup (folder `~/wherdr`, `docker-compose.yml`, `.env`,
data folders, image pull, start). It never uses sudo and asks before replacing a file:

```sh
curl -fsSL https://wherdr.dev/install | sh
```

Read it first if the user wants: https://wherdr.dev/install. Settings, as environment variables:
`WHERDR_DIR` (install folder), `WHERDR_PORT` (port, default 7683), `WHERDR_YES=1` (answer yes
to every question; only with the user's consent).

By hand instead (same result), from https://github.com/afloury/wherdr#recommended-always-on-server--tailscale:

```sh
git clone https://github.com/afloury/wherdr.git
cd wherdr
cp .env.example .env
mkdir -p data "$HOME/.config/herdr" "$HOME/.local/state/herdr/client" "$HOME/.cache/herdr-web" \
  "$HOME/.herdr-projects"
docker compose up -d
```

**Check:** `docker compose ps` (in `~/wherdr`, or the clone) shows the container running;
`curl -fsS http://127.0.0.1:7683` returns HTML; `docker compose logs` shows no error.

Update later: `docker compose pull && docker compose up -d` in the wherdr folder.

## C. Phone over Tailscale

The phone needs HTTPS for the installable app, push notifications and passkeys. Tailscale Serve
gives a private HTTPS address, reachable only from the user's own devices.

1. Ask before installing [Tailscale](https://tailscale.com) on the wherdr machine and on the
   phone (App Store / Play Store app), signed in to the **same Tailscale account** (the
   "tailnet": the user's private network of devices). Then the user, in the Tailscale admin
   console (DNS page), enables
   [MagicDNS and HTTPS certificates](https://tailscale.com/kb/1153/enabling-https); you cannot
   do this for them, and step 2 fails without it.
2. On the wherdr machine:

   ```sh
   tailscale serve --bg --https=7683 http://127.0.0.1:7683
   ```

   **Check:** `tailscale serve status` shows the `https://<machine>.<tailnet>.ts.net:7683/`
   address. Never use `tailscale funnel` (public).
3. wherdr is already running with a local `APP_URL`; now switch it to that HTTPS address and
   restart:
   - Docker: in `~/wherdr/.env` (or the clone's `.env`), set
     `APP_URL=https://<machine>.<tailnet>.ts.net:7683/` with the exact address of step 2, then
     `docker compose up -d`.
   - No Docker: stop wherdr and start it with
     `APP_URL=https://<machine>.<tailnet>.ts.net:7683/ npm start` (or set it in the service).

   Without an HTTPS `APP_URL`, wherdr runs but push notifications are off (it logs a warning).
4. On the phone, open the address:
   - **iPhone** (iOS 16.4+): in **Safari**, Share → **Add to Home Screen**; open wherdr from the
     home screen, then Settings → **Enable notifications** (iOS only notifies the installed app).
   - **Android**: in **Chrome**, menu → **Install app**, then Settings → **Enable notifications**.
5. **Passkey lock**, right away: on the phone, Settings → Security → **Enable passkey lock**. The
   first passkey asks for a bootstrap token: find the line "First passkey: bootstrap token …"
   in the server output (`docker compose logs` with Docker, the `npm start` output otherwise)
   and give the token to the user. It changes at every restart, so take it from the latest
   start. Then add a passkey on each other device (Settings → Security → **Add this device**).

**Check:** the phone opens the address and lists the agents; a test notification arrives when an
agent finishes.

## D. Several machines

wherdr runs on one machine and also shows the agents of the **SSH machines registered in Herdr**
(`herdr machine add`). On each other computer: install Herdr only (not wherdr), the **same
Herdr version** as the wherdr machine (`herdr --version`), its server running, and the agent
integrations ([2](#2-herdr-first)). On the wherdr machine: key-based SSH access to that computer,
then register it in Herdr. The README section
https://github.com/afloury/wherdr#several-machines-ssh has the full example (key, `~/.ssh/config`
entry, first connection, `herdr machine add`); `herdr machine --help` has the options. Ask before
creating SSH keys or editing `~/.ssh/config`. A Mac must allow Remote Login (System Settings →
General → Sharing), which the user turns on.

**Check:** within 30 seconds the machine appears in wherdr in its own section. If not:
`docker compose logs | grep machine` (Docker) shows its state.

## Troubleshooting

- **"The Herdr server is not responding"**: start Herdr (`herdr` or `herdr server`). With Docker,
  check that `HOST_HOME` and `PUID` in `.env` match the user (`id -u`).
- **No conversation, only the terminal**: install the integration
  (`herdr integration install claude|codex|omp`) and start a new agent.
- **Passkeys or notifications unavailable**: the page must be HTTPS (or `localhost`); on iPhone,
  the app must be installed on the home screen.
- **HTTP 403 when opening the app through another name**: use the hostname in `APP_URL`, or add
  that private name to `HERDR_WEB_ALLOWED_HOSTS`, then restart wherdr.
- **Image pull fails**: build from source:
  `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` (needs about
  2 GB of free memory).
- **Remote machine offline**: see https://github.com/afloury/wherdr#troubleshooting.

## Optional: herdr-projects

[herdr-projects](https://github.com/eliasstravik/herdr-projects) is a third-party Herdr plugin
(not part of wherdr): one **coordinator** conversation splits a project into parallel
**threads**, each an agent in its own Git worktree. wherdr shows it natively: project groups in
the agent list and a **Project panel** next to the coordinator that reads the project's
`TASKS.md` (to test, to decide, in progress, backlog…) with one-tap buttons.

Worth it for big projects with several tasks running in parallel; skip it for a first setup.
Mention it, and if the user wants it, follow **its** README for installation (it changes; do not
copy steps from here). Once installed, `herdr-projects skill` prints the coordinator guide and
`herdr-projects doctor` checks the setup. wherdr's side: Settings → Plugins → herdr-projects
(https://github.com/afloury/wherdr#works-great-with-herdr-projects).

## When you are done

Tell the user, in a few lines: the address to open, how to update, and that the passkey lock is
on (or remind them to turn it on).
