# wherdr

**Drive the coding agents running in [Herdr](https://herdr.dev) from your phone.**

## Quick start

With [Herdr](https://herdr.dev) running and Node.js 22, on macOS or Linux (`localhost` only):

```sh
git clone https://github.com/afloury/wherdr.git && cd wherdr
npm ci && npm run build && npm start    # then open http://localhost:7683
```

wherdr is a small self-hosted web app (installable as a PWA) that talks to the Herdr server on
your machine. It lists your agents live — Claude Code, Codex and the other agents Herdr
recognizes — and lets you read their conversations, answer their questions in one tap, send
messages and photos, switch models, open the real terminal and get push notifications when an
agent finishes or needs you. It is the same Herdr session your computer attaches to with
`herdr`: nothing is copied, nothing runs in the cloud.

> [!WARNING]
> **wherdr is a remote shell on your machine.** Anyone who can reach it can start agents and
> run commands as your user. **Never expose it on the public Internet** (no port forwarding, no
> public reverse proxy, no tunnel). Use it on `localhost`, or from your other devices through a
> private network such as [Tailscale](https://tailscale.com). Enabling the passkey lock is
> strongly recommended. See [Security](#security).

<p align="center">
  <img src="docs/screenshots/home-phone.png" alt="Agent list on a phone" width="260">
  <img src="docs/screenshots/chat-phone.png" alt="Conversation view on a phone" width="260">
</p>
<p align="center">
  <img src="docs/screenshots/desktop.png" alt="wherdr on a desktop browser" width="820">
</p>

*Unofficial project. Not affiliated with or endorsed by Herdr, Anthropic or OpenAI. Claude,
Claude Code, Codex and other product names are trademarks of their respective owners.*

## Contents

- [Quick start](#quick-start)
- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Recommended setup](#recommended-setup)
- [Install with Docker](#install-with-docker)
- [Run without Docker](#run-without-docker)
- [Install the app on your phone](#install-the-app-on-your-phone)
- [Configuration](#configuration)
- [Several machines (SSH)](#several-machines-ssh)
- [Claude and Codex quotas](#claude-and-codex-quotas)
- [Notifications](#notifications)
- [Herdr plugins](#herdr-plugins)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing) · [License](#license)

## Features

- **Live agent list**, grouped by state (your turn, working, ready), with a preview of
  each agent's last answer. When an agent asks for permission or asks a question, the options
  show on its card: **answer in one tap** without opening it.
- **Conversation view**: the agent's real transcript (Claude Code and Codex), rendered as
  Markdown, with grouped tool calls, images, timestamps, search and infinite scroll back to the
  first message. Reading a conversation never touches the terminal, so it never resizes the
  pane you are looking at on your computer.
- **Terminal view**: the real terminal (xterm.js, WebGL or DOM renderer) with a key bar for
  phones (Esc, Enter, arrows, Shift+Tab, Ctrl+C…), touch scrolling and take-over.
- **Composer**: send messages while the agent works (queued, cancellable), attach or paste
  photos, run slash commands (`/compact`, `/clear`, `/context`, `/usage`…) and see the output
  of local commands. Stop button while the agent works.
- **Model and effort pickers** for Claude Code and Codex. Changes apply **to the current
  session only**; wherdr never changes your default model.
- **New agent**: pick an installed agent (or a plain terminal), a folder, optionally a separate
  Git **worktree** and branch, resume the last conversation, and queue a first message.
- **Changes view**: Git status and diff of an agent's working folder; worktree management.
- **Global search** across agents and conversations.
- **herdr-projects**: coordinator and threads grouped under their project.
- **Several machines**: agents of the SSH machines registered in Herdr (`herdr machine add`)
  appear in their own section; everything works the same on a remote agent.
- **Named Herdr sessions**: switch between running sessions.
- **Quotas**: remaining Claude and Codex usage limits on the home screen.
- **Web Push notifications** when an agent finishes or needs you, and for
  `herdr notification show` (plugins, scripts).
- **Herdr plugin actions** in the menus.
- **Offline reading** of the last known state and of recently opened conversations.
- **Passkey lock** (Face ID, Touch ID, Windows Hello, Android…).
- **Themes**: herdr.dev (default) and Herdr's built-in themes, or follow your Herdr theme.
- **English and French** interface. Phone and desktop layouts.

## How it works

```
phone / laptop ──private network──> HTTPS (tailscale serve, private proxy)
                                        │
                                        ▼
                             wherdr (Nitro server, 127.0.0.1:7683)
                               ├─ Herdr API socket     ~/.config/herdr/herdr.sock
                               ├─ Herdr client socket  (notifications, passive client)
                               ├─ herdr terminal session control <pane>   (terminal view)
                               ├─ transcripts          ~/.claude, ~/.codex (read only)
                               └─ ssh -M <machine>     (other machines, optional)
```

wherdr runs on the same machine as the Herdr server (the "server" below). It uses Herdr's local
socket API and CLI, reads the agents' transcript files, and serves a client-only Nuxt app. Data
it keeps (VAPID keys, push subscriptions, passkeys, recent folders) lives in `data/`.

Built with Nuxt 4, Nuxt UI 4, Tailwind 4 and TypeScript; the Herdr gateway (API, WebSockets,
Web Push, lock) runs in Nitro.

## Requirements

- **Herdr ≥ 0.9.1** running on the server (`herdr` or `herdr server`), with its Claude Code /
  Codex integrations installed if you use them (`herdr integration install claude|codex`).
- **Linux or macOS** server with either **Docker** (Compose v2) or **Node.js 22**.
  The Docker image is for Linux servers (tested on a Raspberry Pi too). **On macOS, run without
  Docker**: Docker Desktop cannot reach Herdr's Unix socket on the host.
- **HTTPS** to use passkeys, push notifications and the installable app from another device.
  Browsers only allow them on `https://` or `http://localhost`. The easiest way is
  [`tailscale serve`](https://tailscale.com/kb/1312/serve); a reverse proxy **reachable only
  from your private network** with a valid certificate also works.

## Recommended setup

1. Install **Tailscale** on the server and on your phone (and computer), same tailnet.
2. On the server: follow [Install with Docker](#install-with-docker), then publish it on your
   tailnet with `tailscale serve`.
3. On the phone: open `https://<server>.<tailnet>.ts.net:7683/`, **install the app** to the home
   screen, and enable the **passkey lock** (recommended) and **notifications** in Settings.
4. On the computer: use the same address in a browser (desktop layout), next to your terminal.

## Install with Docker

On a **Linux** server (on macOS, see [Run without Docker](#run-without-docker)):

```sh
git clone https://github.com/afloury/wherdr.git
cd wherdr
cp .env.example .env
```

Edit `.env` (every value has a default; `HOST_HOME` defaults to your `$HOME`):

| Variable | Example | Meaning |
| --- | --- | --- |
| `HOST_HOME` | `/home/alice` | Your home folder on the server (default: `$HOME`). Mounted at the same path, read-only. |
| `PUID` / `PGID` | `1000` | Your user and group IDs (`id -u`, `id -g`). |
| `PORT` | `7683` | Listening port, published on `127.0.0.1` only. |
| `APP_URL` | `https://server.example.ts.net:7683/` | Private HTTPS address of the app (also used as the Web Push contact and an allowed host). Use `http://localhost:7683/` for local testing. |
| `HOST_LABEL` | `server` | Name of this machine in the app. |
| `TZ` | `Europe/Paris` | Time zone for timestamps and logs. |

Create the bind-mount folders **before** starting Compose, as your own user. Otherwise Docker
may create missing host folders as root, leaving the container unable to write to them. Set
`PUID` and `PGID` in `.env` to the output of `id -u` and `id -g` for that user.

```sh
mkdir -p data "$HOME/.config/herdr" "$HOME/.local/state/herdr/client" "$HOME/.cache/herdr-web"
```

Then build and start:

```sh
docker compose up -d --build
docker compose logs -f        # optional: follow the logs and find the first-passkey token
```

Publish it on your tailnet (HTTPS certificate included):

```sh
tailscale serve --bg --https=7683 http://127.0.0.1:7683
# → https://<server>.<tailnet>.ts.net:7683/
```

Use that HTTPS address for `APP_URL` in `.env`. The `--https=7683` option makes Tailscale Serve
listen on HTTPS port 7683, matching the URL above; it forwards to wherdr's local HTTP port 7683.
For the first passkey, Settings → Security asks for a bootstrap token. Find it with
`docker logs herdr-web` (or `docker compose logs`). The token changes on each restart and is
only needed when registering the **first** passkey. The passkey lock is recommended but optional;
the app works without one on your private network.

The container runs as your user and mounts your home folder **read-only**, except
`~/.config/herdr` (Herdr sockets), `~/.local/state/herdr/client` (machine names) and
`~/.cache/herdr-web` (uploaded photos, quotas). It uses the server's own `herdr` binary, so the
client and the server always stay on the same version.

To update: `git pull && docker compose up -d --build`.

**Custom icons** (optional): copy `docker-compose.override.example.yml` to
`docker-compose.override.yml` and put your icons in `branding/` (both untracked).

## Run without Docker

With Node.js 22 on the server:

```sh
git clone https://github.com/afloury/wherdr.git
cd wherdr
npm ci
npm run build
npm start                  # listens on 127.0.0.1:7683
```

For another device, start it with its private HTTPS address instead:
`APP_URL=https://server.example.ts.net:7683/ npm start`.

Run it as the user who runs Herdr, with Herdr and Git installed on the same machine. It uses
`$HOME` and `$HOME/.local/bin/herdr`, or `herdr` from the `PATH` (Homebrew); set `HERDR_BIN`
otherwise. `DATA_DIR` holds passkeys, push data and recent folders; without it, the app uses
`./data`. Set `APP_URL` to the private HTTPS address you actually use, or to
`http://localhost:7683/` for local-only access. Publish it with `tailscale serve` as above, or
open `http://localhost:7683` on the same machine. `npm start` listens on `127.0.0.1` (`HOST`)
and port `7683` (`PORT`) by default. Find the first-passkey bootstrap token in the output of
`npm start`. Keep the process running with your usual service manager (systemd user unit,
launchd, tmux…). Passkeys remain optional.

With `APP_URL=http://localhost:7683/`, wherdr starts normally but disables Web Push and logs a
warning. Passkeys and the installable app are available only when the browser itself opens
`localhost`; another device needs private HTTPS. For phone notifications and passkeys, use
`tailscale serve` (or another private HTTPS proxy) and set `APP_URL` to that HTTPS address.

## Install the app on your phone

The app must be served over HTTPS (see [Requirements](#requirements)).

- **iPhone / iPad** (iOS 16.4 or later): open the address in **Safari** → Share →
  **Add to Home Screen**. Open wherdr from the home screen, then Settings → **Enable
  notifications**. On iOS, push notifications only work in the installed app.
- **Android**: open the address in **Chrome** → menu → **Install app** (or Add to Home
  screen), then Settings → **Enable notifications**.
- **Computer**: just use the address in a browser; Chrome and Edge can also install it.

Then Settings → Security → **Enable passkey lock** on each device.

## Configuration

All settings are environment variables (`.env` with Docker).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `7683` | Listening port. |
| `HOST` | `127.0.0.1` (`npm start`) | Listening address without Docker. Keep it on loopback. |
| `HOST_LABEL` | server hostname (`wherdr` in Docker) | Name of this machine in the app (can be renamed in the app). |
| `APP_URL` | *(empty)* | App address and allowed host; a valid HTTPS URL enables Web Push. HTTP, empty or invalid values disable Web Push with a warning. |
| `HERDR_WEB_ALLOWED_HOSTS` | *(empty)* | Additional hostnames or IP addresses allowed to open the app, comma-separated. |
| `PASSKEY_USER` | `wherdr` | User name stored with the passkeys. |
| `DATA_DIR` | `./data` | VAPID keys, push subscriptions, passkeys, recent folders. |
| `HERDR_BIN` | `~/.local/bin/herdr`, else `herdr` in `PATH` | Herdr binary. |
| `HERDR_WEB_SESSION` | *(default session)* | Named Herdr session to drive. Not `HERDR_SESSION`, which Herdr reads itself. |
| `AGENT_KINDS` | all known agents | Agents offered in **New** (only installed ones are shown). |
| `HERDR_WEB_MACHINES` | `on` | `off` to ignore the SSH machines registered in Herdr. |
| `HERDR_WEB_SELF_HOSTS` | | Other names / IPs of this machine, comma-separated (profiles pointing to it are ignored). |
| `HERDR_WEB_REMOTE_SESSION` | | Herdr session to use on every remote machine instead of the profile's. |
| `HERDR_WEB_HERDR_NOTIFICATIONS` | `on` | `off` to stop relaying `herdr notification show` as push. |
| `UPLOAD_DIR` | `~/.cache/herdr-web/uploads` | Where photos sent to agents are stored (deleted after 7 days). |
| `TZ` | `UTC` | Time zone. |

In the app, **Settings** holds per-device preferences: language, theme, notifications, terminal
text size and renderer, typing effect, what the home screen shows, and the passkey lock.

## Several machines (SSH)

wherdr also shows the agents of the **SSH machines registered in Herdr** — the ones the Herdr
terminal client shows in its sidebar. It opens one SSH master connection per machine, forwards
the remote Herdr socket through it, and reads transcripts and files over the same connection.

Requirements on the remote machine: the **same Herdr version** (`herdr --version`), its server
running, and key-based SSH access from the server. Example, on the server:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/wherdr_ed25519 -N ''
cat >> ~/.ssh/config <<'CFG'
Host laptop
  HostName laptop
  User alice
  IdentityFile ~/.ssh/wherdr_ed25519
  IdentitiesOnly yes
CFG
ssh-copy-id -i ~/.ssh/wherdr_ed25519 laptop
ssh laptop true                            # accept the host key once
herdr machine add laptop --label Laptop    # see `herdr machine --help`
```

wherdr picks it up within 30 seconds; `herdr machine rename|disable|remove` work the same way.
Machines can also be renamed from the app (machine menu → Options).

With Docker, the image includes `openssh-client` and reads `~/.ssh` through the read-only home
mount. `PUID` must be `1000` for ssh to find `~/.ssh` (the image maps user 1000 to `HOST_HOME`).

## Claude and Codex quotas

The home screen shows what is left of the Claude and Codex usage limits (5-hour window and
week, with reset times), for every online machine.

- **Codex**: nothing to do, Codex writes its limits in its session files. Machines on different
  Codex accounts get one block each (told apart by a short hash of the account ID found in the
  session files; `~/.codex/auth.json` is never read).
- **Claude Code** only gives them to its status line. On each machine, install wherdr's
  invisible status line (it displays nothing, and chains to your existing status line if you
  have one):

  ```sh
  sh scripts/install-claude-statusline.sh
  ```

  The app offers the same thing: a banner "Claude quotas not configured" with **Install** (runs
  it over SSH on a remote machine) and **Copy command**. Quotas show after the next exchange with
  a Claude agent. The status line stores the limits in `~/.cache/herdr-web/claude-status.json`
  and a short hash of the account ID (never a token or email) to tell accounts apart.

  **New machine**: run `sh scripts/install-claude-statusline.sh` on it once (or click **Install** in
  the banner), then send a message to any Claude agent there; its quotas appear on the home screen.

## Notifications

With notifications enabled on a device, wherdr sends a Web Push when an agent goes from working
to **blocked** (with its question and options) or to **done** (with the start of its answer).
There is no push for the agent currently on screen. Settings → Notifications lets each device
choose between all agents and main agents only (herdr-projects threads are muted by default).

wherdr also relays custom notifications sent with `herdr notification show` (plugins, scripts).
To receive them it connects to Herdr's client socket as a **passive** client: it never becomes
the foreground client and never resizes anything. Side effects: with wherdr connected,
`notification show` reports `shown: true` even with no terminal attached, and an empty session
gets a default workspace, as with any attached client.

## Herdr plugins

Actions declared by the plugins installed on a machine (`herdr plugin install|link`) appear in
the menus: workspace / tab / pane actions in the agent menu, global actions in the machine menu.
wherdr always passes the agent's pane explicitly. It asks for confirmation before running an
action, except for actions that only show or check something (list, show, status, doctor…).
Actions that open a plugin panel open it in the attached Herdr terminal client, not on the phone.

## Security

wherdr drives Herdr, so **it can run anything as your user**. Docker does not change that: the
container talks to the Herdr server running on the host.

- It listens on `127.0.0.1` only. Reach it from other devices **only through a private
  network** (Tailscale or equivalent). Never add a public route (port forwarding, public reverse
  proxy, Cloudflare Tunnel, ngrok…).
- Requests are accepted only for `localhost`, loopback addresses, the runtime's hostname, the
  hostname in `APP_URL`, and the runtime's network interface addresses (those of the container
  with Docker). Add other private names or IP addresses to `HERDR_WEB_ALLOWED_HOSTS`
  (comma-separated) before using them. An unlisted name returns HTTP 403 (`host` / "Host not
  allowed"); add it to `HERDR_WEB_ALLOWED_HOSTS`, then restart wherdr. This host check also
  applies to WebSockets.
- **Passkey lock** (Settings → Security, recommended): once a passkey is registered, the API,
  images, photos and WebSockets require an unlocked session (signed HttpOnly cookie, 12 hours).
  Turning the lock off invalidates every session. Lost passkey: delete `data/auth.json` on the
  server; the app is open again to whoever can reach it.
- Without a passkey, **anyone who can reach the address can control your agents**: every device
  on your tailnet, and every user of your tailnet if you share it.
- Writes require `Content-Type: application/json` (or `image/*` for photos) and an `Origin`
  matching the host, WebSockets included.
- A strict Content Security Policy limits scripts to the app's own origin and hashed inline
  scripts, and connections to that origin and its WebSockets. It also blocks embedded objects
  and framing.
- wherdr never changes your agents' global settings: model and effort changes are for the
  current session only.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Troubleshooting

- **"The Herdr server is not responding"**: start Herdr on the server (`herdr` or
  `herdr server`). With Docker, check that `HOST_HOME` and `PUID` match your user.
- **No conversation, only the terminal**: the agent was started before the Herdr integration
  was installed, or it is not Claude Code / Codex. Install the integration
  (`herdr integration install claude|codex`) and start a new agent.
- **Passkeys or notifications unavailable**: the page must be served over HTTPS (or
  `localhost`). On iPhone, notifications need the app installed on the home screen.
- **HTTP 403 when opening the app through another name**: add that private hostname or IP
  address to `HERDR_WEB_ALLOWED_HOSTS`, or use the hostname in `APP_URL`, then restart wherdr.
- **Remote machine offline**: `docker compose logs | grep machine` shows its state. Test SSH as
  wherdr does, from the container:
  `docker compose exec herdr-web ssh -o BatchMode=yes laptop '~/.local/bin/herdr status server'`.
  - `Could not resolve hostname`: container DNS (use the full name in `HostName`);
  - `Permission denied (publickey)` / `Host key verification failed`: key or `known_hosts`
    (run `ssh laptop true` once on the server);
  - `Bad owner or permissions`: `~/.ssh/config` must belong to you and not be group-writable.
- **Claude says "Not logged in" on a Mac** whose Herdr server was started over SSH: the macOS
  keychain is locked in SSH sessions. Start the Herdr server from a terminal on the Mac.
- **Quotas missing**: see [Claude and Codex quotas](#claude-and-codex-quotas).
- **iPhone layout cut at the bottom** after changing the status bar style: reinstall the home
  screen icon (iOS reads this setting at install time).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

Every commit is public, so a leak check runs on the files tracked or staged in git:

```sh
cp .leak-patterns.example .leak-patterns   # git-ignored: list your own names, hosts, e-mails, IPs
npm run check:leaks                        # gitleaks (if installed) + your forbidden patterns
npm run hooks:install                      # optional: same check on staged files before each commit
```

Matches are printed as `file:line`, truncated so the secret itself is never shown, and the command
exits with a non-zero code. Install [gitleaks](https://github.com/gitleaks/gitleaks) to also catch
tokens and keys.

## License

[MIT](LICENSE). The embedded font subsets keep their own licenses (`app/assets/fonts/`).
