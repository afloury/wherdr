<p align="center">
  <img src="server/assets/branding/icons/icon-512.png" alt="wherdr logo" width="120">
</p>

<h1 align="center">wherdr</h1>

<p align="center"><b>A complete workspace for the coding agents running in <a href="https://herdr.dev">Herdr</a>, on your
computer and on your phone.</b></p>

<p align="center"><a href="https://wherdr.dev"><b>wherdr.dev</b></a> · <code>curl -fsSL https://wherdr.dev/install | sh</code> · <code>herdr plugin install afloury/wherdr</code></p>

<p align="center"><a href="https://wherdr.dev/demo/"><b>Try it in your browser — no install</b></a>: the real app on scripted agents, nothing runs.</p>

<p align="center"><a href="https://github.com/afloury/wherdr/actions/workflows/ci.yml"><img src="https://github.com/afloury/wherdr/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a></p>

## Quick start

On the computer that runs [Herdr](https://herdr.dev) (≥ 0.9.1), macOS or Linux, one command:

```sh
curl -fsSL https://wherdr.dev/install | sh
```

It installs the wherdr [Herdr plugin](#install-as-a-herdr-plugin), starts wherdr on
`http://localhost:7683` and opens its setup guide in your browser; then **prefix+i** in Herdr opens
the wherdr panel. Without Herdr, it says where to get it; on a Mac without Node.js 22, it offers
`brew install node`; on Linux, Docker works too. On a server without a screen (or over SSH), it
prints the address and the phone steps instead. See [The one command](#the-one-command).

Other ways, after it: `herdr plugin install afloury/wherdr` (the same plugin, without the
checks), `npx wherdr` (or `bunx wherdr`, `pnpm dlx wherdr`; see
[the `wherdr` command](#the-wherdr-command)), `brew install afloury/tap/wherdr`, or
[Docker by hand](#recommended-always-on-server--tailscale).

At first launch, wherdr opens a **setup guide**: the Herdr agents it found, your phone
(Tailscale), then the passkey lock and notifications. Skip it any time; finishing or skipping is
saved on the server (`data/onboarding.json`), so your other devices do not show it again. Reopen
it from Settings › About › **Setup guide**. On a phone that already opens wherdr through its
tailnet address, the phone step becomes Add to Home Screen.

**Passkeys are tied to the address they are created on.** Once wherdr's tailnet address is
published and answers, the guide opened on `localhost` shows **Continue on
<machine>.<tailnet>.ts.net**, which reopens it at the same step on that address, and its Security
step (like Settings › Security) sends the passkey lock there. Nothing redirects on its own:
`localhost` stays valid on the computer. The installer, the Herdr plugin and `wherdr open` open
that address too when it is already published.

wherdr is a small self-hosted web app that talks to the Herdr server on your machine. **On a
computer**, it can replace the Herdr terminal client day to day: your spaces, tabs and split panes
side by side, live conversations and real terminals, drag-and-drop layout, keyboard shortcuts
and a project board for herdr-projects. **On a phone**, installed as a PWA, it is the companion
that follows your agents when you are away: push notifications when an agent finishes or needs
you, one-tap answers, quick replies and offline reading.

It lists your agents live — Claude Code, Codex and the other agents Herdr recognizes — and works
on the same Herdr session `herdr` attaches to: nothing is copied, nothing runs in the cloud. Use
it on `localhost`, or from your other devices over Tailscale.

> [!WARNING]
> **wherdr is a remote shell on your machine.** Anyone who can reach it can start agents and
> run commands as your user. **Never expose it on the public Internet** (no port forwarding, no
> public reverse proxy, no tunnel). Use it on `localhost`, or from your other devices through a
> private network such as [Tailscale](https://tailscale.com). Enabling the passkey lock is
> strongly recommended. See [Security](#security).

<p align="center">
  <img src="docs/screenshots/desktop.png" alt="wherdr on a computer: agent sidebar and conversation" width="900">
</p>
<p align="center"><sub>On a computer</sub></p>
<br>
<p align="center">
  <img src="docs/screenshots/home-phone.png" alt="Agent list on a phone" width="340">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/chat-phone.png" alt="Conversation view on a phone" width="340">
</p>
<p align="center"><sub>On a phone: the same agents, the same session.</sub></p>

*Unofficial project. Not affiliated with or endorsed by Herdr, Anthropic or OpenAI. Claude,
Claude Code, Codex and other product names are trademarks of their respective owners.*

## Why wherdr

- **Herdr's splits, live.** A tab with several panes is drawn in Herdr's real layout, every pane
  live; drag a pane to move it or a divider to resize, and the change goes to Herdr itself.
- **A passkey lock.** Face ID, Touch ID, Windows Hello or Android unlock the app; once a passkey
  exists, nothing about your agents is served to a locked session.
- **The agent's diff.** Git status and diff of each agent's working folder, one click away from
  its conversation.
- **The herdr-projects board.** A coordinator and its threads grouped under their project, with
  the project's task lists as a live board and one-click replies.
- **Keyboard and global search.** One shortcut searches every agent and conversation; next
  agent, new tab, pane swaps and `1`–`9` answers never need the mouse.
- **Real time, and private.** The real terminal over a WebSocket, a push when an agent needs
  you, and your phone through Tailscale: nothing is on the Internet.

Details in [Features](#features) and [Security](#security).

## Contents

- [Quick start](#quick-start)
- [Why wherdr](#why-wherdr)
- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation): [the one command](#the-one-command) ·
  [which setup?](#which-setup) ·
  [always-on server + Tailscale](#recommended-always-on-server--tailscale) ·
  [other private networks](#other-private-networks) ·
  [the `wherdr` command](#the-wherdr-command) ·
  [from source](#from-source-no-docker) ·
  [as a Herdr plugin](#install-as-a-herdr-plugin) ·
  [Docker on a Mac: Reveal/Open](#wherdr-in-docker-on-a-mac-reveal-in-finder-open-and-modalto)
- [Updating](#updating)
- [Install it as an app](#install-it-as-an-app)
- [Configuration](#configuration)
- [Several machines (SSH)](#several-machines-ssh)
- [Claude and Codex quotas](#claude-and-codex-quotas)
- [Notifications](#notifications)
- [Works great with herdr-projects](#works-great-with-herdr-projects)
- [Herdr plugins](#herdr-plugins)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing) · [License](#license)

## Features

### Everywhere

- **Live agent list**, one line per Herdr space, grouped by state (your turn, working, ready),
  with a preview of each agent's last answer. When an agent asks for permission or asks a
  question, the options show on its card: **answer in one tap** without opening it.
- **Conversation view**: the agent's real transcript (Claude Code, Codex and omp), rendered as
  Markdown, with grouped tool calls, images (full-screen viewer with pinch / wheel zoom and pan), timestamps, search and infinite scroll back to the
  first message. Reading a conversation never touches the terminal, so it never resizes a pane.
  A command the agent proposes (shell code block, or inline `! command`) can be copied without
  its prompt, or run in the agent's shell mode (`!`, Claude Code, Codex and omp) after you
  confirm the full command.
- **Terminal view**: the real terminal (xterm.js, WebGL or DOM renderer) with take-over. Opening
  it resizes the real pane to your screen; closing it gives the pane the size it had before
  (after 30 seconds when the connection just dropped, e.g. a locked phone), unless a Herdr
  client attached meanwhile laid it out its own way. On a
  computer, drag over the text on screen to select it: releasing the button copies it, as do
  `⌘C` / `Ctrl+Shift+C`. The history is browsed with the wheel, not by dragging past the edge.
  Links (OSC 8 hyperlinks and plain `http(s)://` URLs, even wrapped over several rows) open in a
  new tab with `⌘`+click / `Ctrl`+click, or a tap on a phone; only http and https open. A long
  line wrapped by the width is copied in one piece, without the breaks between its rows. An image
  pasted with `⌘V` (Mac), here or in a side-by-side terminal, goes to the agent's machine and its
  path is pasted, which omp and Claude Code attach as an image, as in the conversation.
- **Composer**: send messages while the agent works (queued, cancellable), attach or paste
  photos and the files the agent can read (Claude Code: PDFs, notebooks, text and code of any
  extension; Codex: notebooks, text and code), run slash commands (`/compact`, `/clear`, `/context`, `/usage`…) and see the output
  of local commands. Stop button while the agent works. A long pasted text (log, output) becomes
  a "Pasted text · N lines" card, sent to the agent as it is and shown the same way in the
  conversation, where it opens in full with Copy; long typed messages fold with Show more.
- **Codex updates and limits**: in a Codex conversation, a new Codex version shows above the
  field with an **Update** button (runs Codex's official update command on that machine, after
  confirmation), then **Restart to update** on the same conversation. When wherdr cannot run it
  (Docker, read-only home), Update exits Codex, runs the command in the agent's own terminal and
  resumes the same conversation (only while Codex is idle). Codex's own weekly-limit warning
  (its footer gauge, or its startup heads-up) is repeated above the field, with its values, while
  Codex shows it.
- **Model and effort pickers** for Claude Code, Codex and omp (omp: its
  "Switch Model" selector, `/switch` or `/model`, and its thinking level, changed with its own
  ⇧⇥ cycle). Changes apply **to the current session only**; wherdr never changes your default
  model.
- **New agent**: pick an installed agent (or a plain terminal), a folder, optionally a separate
  Git **worktree** and branch, resume the last conversation, and queue a first message.
- **Changes view**: Git status and diff of an agent's working folder; worktree management.
- **Several machines**: agents of the SSH machines registered in Herdr (`herdr machine add`)
  appear in their own section; everything works the same on a remote agent.
- **Named Herdr sessions**, **quotas** (remaining Claude and Codex usage limits), **Herdr plugin
  actions** in the menus, **passkey lock** (Face ID, Touch ID, Windows Hello, Android…).
- **Themes**: wherdr Titanium (default), herdr.dev and Herdr's built-in themes, or follow your Herdr theme.
  **English and French** interface.

### On a computer

- **Split panes, live**: a tab with several panes is drawn with Herdr's real layout; every pane
  shows its conversation or terminal live, and the one you click becomes interactive.
- **Rearrange the layout**: drag a pane onto another to move it, drag a divider to resize
  (arrow keys work on a focused divider); changes go to Herdr itself.
- **Spaces and tabs**: sidebar with every space, tabs at the top, active tab remembered per space.
  The sidebar can be resized, or collapsed to a narrow rail (search, new agent, settings and
  state counters) with the button next to Settings; the choice is kept on the device.
- **Keyboard shortcuts** (`Mod` is ⌘ on macOS, Ctrl elsewhere; `Mod+/` or `?` lists them all,
  also in Settings › Computer):
  - `Ctrl/⌘+K` global search across agents and conversations, `Alt+↑/↓` previous / next agent
    in the list, `Mod+,` settings.
  - `Mod+Alt+N` new agent in a new space, `Mod+Alt+T` new tab in the current space,
    `Mod+Alt+W` close the current pane (after confirmation). They work from the terminal too.
  - With [herdr-projects](#works-great-with-herdr-projects) on the agent's machine: `Mod+Alt+P`
    shows or collapses the Project panel of the current agent's project (from a thread, it opens
    the coordinator), and `Mod+Alt+Shift+N` opens **New project**.
  - In an agent: `Mod+F` searches the conversation, ``Ctrl+` `` switches between conversation
    and terminal, and `Esc` stops a working agent when the message field is empty.
  - `Alt+Shift+arrows` swaps the current pane with its neighbour, `Ctrl/⌘+Alt+arrows` moves
    focus to the neighbouring pane in a side-by-side tab, `Esc` closes dialogs, `Enter` sends
    and `Shift+Enter` adds a new line. On a "Your turn" card, `1`–`9` pick an option (on AZERTY
    without Shift too, outside the message field); on the `/resume` card, `Ctrl+A` switches
    between every project and the current one (`⌘A` still selects all on macOS).
- **Project board** for [herdr-projects](#works-great-with-herdr-projects): coordinator and threads grouped
  under their project, and a side panel with the project's task lists (to test, to decide,
  to review, in progress, in queue, blocked, to do, backlog — each optional) and one-click
  replies to the coordinator.
- **Settings** in a sidebar, with desktop-only options such as the content width.

### On a phone

- **Installable app (PWA)** on iPhone and Android, with safe-area and keyboard handling.
- **Web Push notifications** when an agent finishes or needs you (with its question), and for
  `herdr notification show` (plugins, scripts).
- **Quick replies**: answer permissions and questions in one tap from the agent list.
- **Split tabs on a small screen**: a plan of the tab's panes in Herdr's proportions, then each
  pane full screen with a mini-map and swipe to its neighbours.
- **Terminal key bar** (Esc, Enter, arrows, Shift+Tab, Ctrl+C…) and touch scrolling.
- **Offline reading** of the last known state and of recently opened conversations.

## How it works

```
phone / laptop ──private network──> HTTPS (tailscale serve, private proxy)
                                        │
                                        ▼
                             wherdr (Nitro server, 127.0.0.1:7683)
                               ├─ Herdr API socket     ~/.config/herdr/herdr.sock
                               ├─ Herdr client socket  (notifications, passive client)
                               ├─ herdr terminal session control <pane>   (terminal view)
                               ├─ transcripts          ~/.claude, ~/.codex, ~/.omp (read only)
                               └─ ssh -M <machine>     (other machines, optional)
```

wherdr runs on the same machine as the Herdr server (the "server" below). It uses Herdr's local
socket API and CLI, reads the agents' transcript files, and serves a client-only Nuxt app. Data
it keeps (VAPID keys, push subscriptions, passkeys, recent folders) lives in `data/`.

Built with Nuxt 4, Nuxt UI 4, Tailwind 4 and TypeScript; the Herdr gateway (API, WebSockets,
Web Push, lock) runs in Nitro.

## Requirements

- **Herdr ≥ 0.9.1** running on the server (`herdr` or `herdr server`), with its Claude Code /
  Codex / omp integrations installed if you use them (`herdr integration install claude|codex|omp`).
  omp's conversation is only found through its integration, which reports the session file.
- **Linux or macOS** server with either **Docker** (Compose v2) or **Node.js 22**.
  The Docker image is for Linux servers (tested on a Raspberry Pi too). **On macOS, run without
  Docker**: Docker Desktop cannot reach Herdr's Unix socket on the host.
- **HTTPS** to use passkeys, push notifications and the installable app from another device.
  Browsers only allow them on `https://` or `http://localhost`. The easiest way is
  [`tailscale serve`](https://tailscale.com/kb/1312/serve); a reverse proxy **reachable only
  from your private network** with a valid certificate also works (see
  [Other private networks](#other-private-networks)).

## Installation

### The one command

On the computer that runs Herdr, as your user, on macOS or Linux:

```sh
curl -fsSL https://wherdr.dev/install | sh
```

The script ([read it first](https://wherdr.dev/install), source in
[`website/public/install`](website/public/install)) never uses sudo. It:

1. checks **Herdr ≥ 0.9.1**; without it, it stops with the link to [herdr.dev](https://herdr.dev);
2. leaves alone a wherdr that **already answers** on the port: a Herdr plugin install is offered
   its update, a Docker install shows its update command, anything else is left as it is. A
   `wherdr` container managed from another folder is never replaced or stopped;
3. checks what wherdr runs on: Docker Compose v2 on Linux when your user can use it, otherwise
   **Node.js 22** or Bun (always on macOS). On a Mac without them, it offers
   `brew install node` when Homebrew is there; elsewhere it stops with the install links;
4. runs `herdr plugin install afloury/wherdr --yes`: the [Herdr plugin](#install-as-a-herdr-plugin)
   installs wherdr in `~/wherdr`, starts it on `http://localhost:7683`, starts it again with Herdr,
   opens the setup guide in your browser (first install) and binds **prefix+i** to its panel;
5. on a computer **without a screen** (no `DISPLAY` on Linux, or an SSH session): opens nothing,
   prints the local address, an `ssh -L` tunnel to reach it from your computer, and the phone
   steps (`wherdr phone`: Tailscale state, the address, the QR code once it answers). With
   Docker, it offers to run `tailscale serve` for you (asked first), and wherdr enables the
   published address by itself: no browser is needed on the server. Run the command again at
   any time to check the phone address.

Settings, as environment variables (`curl -fsSL https://wherdr.dev/install | WHERDR_PORT=7684 sh`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `WHERDR_DIR` | `~/wherdr` | Install folder (plugin settings, data, log). |
| `WHERDR_PORT` | `7683` | Local port. |
| `WHERDR_MODE` | — | `native`: Node.js even when Docker is there. `docker`: no plugin, Docker Compose by hand in `WHERDR_DIR` (Linux; see below). |
| `WHERDR_YES` | — | `1` answers yes to every question (non-interactive use). |
| `WHERDR_NO_BROWSER` | — | `1` never opens a browser. |
| `WHERDR_REF` | latest | Git tag or branch of the plugin (or of `docker-compose.yml` with `WHERDR_MODE=docker`). |
| `WHERDR_PLUGIN` | `afloury/wherdr` | A local checkout to link and build instead (development, tests). |

**Docker by hand, with the script:** `curl -fsSL https://wherdr.dev/install | WHERDR_MODE=docker sh`
writes `docker-compose.yml` and `.env` to `~/wherdr`, creates the bind-mount folders, pulls the
published image and starts it, without the plugin; it asks before replacing a file it did not
create. The same steps by hand are in the next section.

Update: run the command again (it offers the update), or **U** in the wherdr panel.

### Which setup?

| | **Always-on server + Tailscale** (recommended) | **One computer** |
| --- | --- | --- |
| Runs on | A machine that never sleeps: Raspberry Pi, mini-PC, home server, private VPS (Linux) | The computer you work on (macOS or Linux) |
| Reach it from | Your phone and every computer on your tailnet | That computer only (`http://localhost:7683`) |
| Installable app, push notifications, passkeys | Yes (private HTTPS from `tailscale serve`) | Desktop browser only; no phone access |
| Other machines (a Mac, a laptop…) | Added in Herdr over SSH, shown in wherdr | Also possible, but they are only reachable while this computer is awake |

Both use [the one command](#the-one-command) and the same app. You can start with the second one
and move to the first later.

### Recommended: always-on server + Tailscale

Your agents keep running when your laptop is closed, and you follow them from your phone.
wherdr stays on your private network: it is **never published on the Internet**.

**1. Herdr on the server.** Install [Herdr](https://herdr.dev) (≥ 0.9.1) and start it
(`herdr` or `herdr server`), with the integrations of the agents you use
(`herdr integration install claude|codex`).

**2. wherdr.** Run [the one command](#the-one-command) on the server (over SSH, it prints the
address and the phone steps instead of opening a browser), then go to step 3. Or set up Docker
Compose by hand (Linux, Compose v2), as follows:

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
| `APP_URL` | `http://localhost:7683/` | Leave it with Tailscale: wherdr adopts the address of step 3 by itself. Set a private HTTPS address only for [another private network](#other-private-networks) (Web Push contact and allowed host; it then always wins). |
| `HOST_LABEL` | `server` | Name of this machine in the app. |
| `TZ` | `Europe/Paris` | Time zone for timestamps and logs. |
| `WHERDR_UPDATE_CHECK` | `off` | Disable the daily check for a new release (default `on`). |

Create the bind-mount folders **before** starting Compose, as your own user. Otherwise Docker
may create missing host folders as root, leaving the container unable to write to them.

```sh
mkdir -p data "$HOME/.config/herdr" "$HOME/.local/state/herdr/client" "$HOME/.cache/herdr-web" \
  "$HOME/.herdr-projects"
docker compose up -d          # pulls ghcr.io/afloury/wherdr (arm64 and amd64)
docker compose logs -f        # optional: follow the logs and find the first-passkey token
```

The container runs as your user and mounts your home folder **read-only**, except
`~/.config/herdr` (Herdr sockets), `~/.local/state/herdr/client` (machine names),
`~/.cache/herdr-web` (uploaded photos and files, quotas) and `~/.herdr-projects` (herdr-projects
projects, see [Works great with herdr-projects](#works-great-with-herdr-projects)). It uses the
server's own `herdr` binary, so the client and the server always stay on the same version.

The repository is only needed for `docker-compose.yml` and `.env`: the image is prebuilt and
published for each release. To build it from source instead, see [Updating](#updating).
**Custom icons** (optional): copy
`docker-compose.override.example.yml` to `docker-compose.override.yml` and put your icons in
`branding/` (both untracked).

**3. Private HTTPS with Tailscale.** Install [Tailscale](https://tailscale.com) on the server,
your phone and your computers, on the same tailnet, with
[MagicDNS and HTTPS certificates](https://tailscale.com/kb/1153/enabling-https) enabled. Then,
on the server:

```sh
tailscale serve --bg --https=7683 http://127.0.0.1:7683
# → https://<machine>.<tailnet>.ts.net:7683/   (e.g. https://server.example.ts.net:7683/)
```

Tailscale Serve listens on HTTPS port 7683 of your tailnet name, with a valid certificate, and
forwards to wherdr's local HTTP port. Only devices of your tailnet can reach it.

**wherdr enables that address by itself**, on a server without a screen too: at startup, every
30 seconds, and when an address it does not know yet is opened, it reads what `tailscale serve`
publishes on this machine and adopts the HTTPS address that points to its own port (allowed
host and `APP_URL`, saved in `data/app-url.json`; an HTTPS `APP_URL` in `.env` wins). An address
removed from `tailscale serve` is refused again. Nothing a request says can enable an address:
only Tailscale's own state on the machine does, and an address that `tailscale funnel` opens to
the Internet is never adopted. Without Docker, wherdr runs the `tailscale` command; in Docker
it reads Tailscale's socket, mounted by `docker-compose.yml` (`/var/run/tailscale`). After
Tailscale itself restarts (an update), restart the container.

What that mount gives: Tailscale's local API, with the rights of the host user the container
runs as. Anyone may read it; if that user is Tailscale's operator
(`tailscale set --operator=$USER`), the API also accepts changes from it (serve, funnel…), and
`:ro` on the folder does not prevent that. wherdr itself only sends `GET` requests. This is not
a new privilege: the container already drives Herdr, which is a shell of that same user. To do
without it, remove the line from `docker-compose.yml`: wherdr then no longer finds the address
by itself, and the one command (or the plugin's phone step) run after `tailscale serve` hands
it over.

**Settings › Phone** on the server (`http://localhost:7683/#/settings?section=phone`) shows the
state and the QR code; without Docker it also publishes wherdr itself: one button, asked first.
From a terminal, `wherdr phone` (npm, Homebrew) or the [one command](#the-one-command) run again
(Docker, Herdr plugin) checks the same thing, and
`curl -fsS http://127.0.0.1:7683/api/phone` prints the state as JSON. A container started from
an older `docker-compose.yml` has no Tailscale socket: paste the address in Settings › Phone,
or run the one command again, which sends it.

If the phone shows **"This address isn't enabled yet"** (403), the address it opened is not one
`tailscale serve` publishes for wherdr's port on that machine: the page gives the command to run
there.

**Why HTTPS matters.** Browsers only allow three things on `https://` (or on `localhost` itself):

- **installing the app** on the home screen (PWA) on iPhone and Android;
- **push notifications** (on iOS, only in the installed app);
- **passkeys** for the lock screen (Face ID, Touch ID, Windows Hello, Android).

**4. On the phone:** open the address, [install the app](#install-it-as-an-app), then
Settings → **Enable notifications**. **On the computer:** use the same address in a browser; the
desktop layout can replace the Herdr terminal client for daily work.

**5. Passkey lock** (recommended, optional): Settings → Security → **Enable passkey lock**. The
first passkey asks for a bootstrap token, printed in the server logs (`docker compose logs`);
it changes on each restart and is only needed for that first passkey. Add a passkey on each of
your devices after that (see [New device](#new-device) below). Without one, every device of your
tailnet can control your agents.

**6. More machines** (optional): register your other computers in Herdr over SSH
(`herdr machine add`, see [Several machines (SSH)](#several-machines-ssh)). Their agents show
in wherdr in their own section, and everything works the same on them. The machine menu also has
**Keep awake**, which stops a Mac (`caffeinate`) or a Linux machine (`systemd-inhibit`) from
sleeping for an hour, four hours, the evening or until turned off.

> [!CAUTION]
> Never publish wherdr on the Internet: no port forwarding on your router, no public reverse
> proxy, no ngrok, no `tailscale funnel`, no Cloudflare Tunnel without Cloudflare Access. Use
> `tailscale serve`, which stays inside your tailnet. See [Security](#security).

### Other private networks

Tailscale is the built-in path (one click in **Settings › Phone**), not a requirement. wherdr
works with any private network that gives it an **HTTPS address with a valid certificate**:

- **HTTPS with a certificate your phone trusts.** The installed app (PWA), push notifications
  and passkeys only work on `https://`. A self-signed certificate or plain `http://` on your
  LAN is not enough, and is never a supported way to reach wherdr.
- **`APP_URL` set to that address** (`.env` with Docker, or the environment of `wherdr` /
  `npm start`), then restart wherdr. Its hostname is allowed automatically and it enables Web
  Push. Add `HERDR_WEB_ALLOWED_HOSTS` only if you also open wherdr under another name. The
  automatic adoption and the address check in **Settings › Phone** only know the `*.ts.net`
  addresses of `tailscale serve`; an HTTPS `APP_URL` in the environment always wins.
- **Never exposed without authentication.** wherdr keeps listening on `127.0.0.1`; only the
  proxy listens on the private network. Turn on the passkey lock as soon as another device can
  reach it.

**Headscale, NetBird, ZeroTier, WireGuard: the same recipe.** Join the server and the phone to
the network, give the server a DNS name that points to its **private** address, and put a reverse
proxy in front of wherdr that listens on that private address only. Let's Encrypt cannot reach a
private address, so the certificate comes from the
[DNS challenge](https://caddyserver.com/docs/automatic-https#dns-challenge). With
[Caddy](https://caddyserver.com) built with your DNS provider's
[module](https://github.com/caddy-dns) (here [Cloudflare DNS](https://github.com/caddy-dns/cloudflare)),
a `Caddyfile` like this ([`bind`](https://caddyserver.com/docs/caddyfile/directives/bind),
[`tls`](https://caddyserver.com/docs/caddyfile/directives/tls)):

```caddy
wherdr.example.com {
	bind 100.64.0.10                 # the server's address on the private network only
	tls {
		dns cloudflare {env.CF_API_TOKEN}
	}
	reverse_proxy 127.0.0.1:7683
}
```

Point `wherdr.example.com` (an `A` record in your DNS zone) to that private address: from
anywhere else it leads nowhere. Then set `APP_URL=https://wherdr.example.com/` and restart
wherdr. To join each device:

| Network | Join a device (official docs) | Server's private address |
| --- | --- | --- |
| [Headscale](https://headscale.net/stable/usage/getting-started/) | Tailscale clients: `tailscale up --login-server <YOUR_HEADSCALE_URL>` | `tailscale ip -4` |
| [NetBird](https://docs.netbird.io/get-started/cli) | `netbird up` (`--management-url` when self-hosted) | `netbird status` |
| [ZeroTier](https://docs.zerotier.com/start) | `zerotier-cli join <network ID>`, then authorize the device in the network's members | The members list of your network |
| [WireGuard](https://www.wireguard.com/quickstart/) | `wg-quick up wg0` with a peer per device | The `Address` of the server's interface |

Headscale does not support `tailscale serve` with HTTPS yet
([features](https://headscale.net/stable/about/features/),
[#1921](https://github.com/juanfont/headscale/issues/1921)): `tailscale cert` and Serve need
certificates that only Tailscale's own control server provisions. Use the reverse proxy above
instead of step 3.

**Cloudflare Tunnel + Cloudflare Access: only with Access.**

> [!WARNING]
> A Cloudflare Tunnel puts wherdr **on the Internet**: anyone can reach its address, and
> Cloudflare terminates TLS, so it sees all traffic. **Cloudflare Access is mandatory**, created
> *before* the route: without it, whoever finds the address controls your agents. Keep the
> passkey lock on as well. Prefer a private network when you can.

1. In Cloudflare One, create the Access application first:
   [Self-hosted and private › Add public hostname](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
   `wherdr.example.com`, with an **Allow** policy for your own e-mail only (Access applications
   deny everyone else by default).
2. [Create a tunnel](https://developers.cloudflare.com/tunnel/setup/) and run `cloudflared` on the
   server, then add a **published application** route: hostname `wherdr.example.com`, service
   `http://localhost:7683`.
3. Set `APP_URL=https://wherdr.example.com/` and restart wherdr.

Installing the app and notifications behind Access are not tested by the project: the phone must
first sign in to Access in the browser.

### The `wherdr` command

The npm package holds the built app: nothing is compiled on your machine. Try it with
`npx wherdr` (or `bunx wherdr`, `pnpm dlx wherdr`); to keep it, install it once:

```sh
npm install -g wherdr       # or: pnpm add -g wherdr, bun add -g wherdr
wherdr service install      # starts at every login; prints the address
wherdr phone                # phone state, the app's phone setup page, QR code once it answers
```

| Command | What it does |
| --- | --- |
| `wherdr` (or `wherdr run`) | Runs in the foreground; Ctrl+C stops it. |
| `wherdr start` · `stop` · `restart` | Background server, pid and log in `~/wherdr`. `start` says *started* only once the port answers; otherwise it prints the end of the log. With a login service installed, they drive the service. |
| `wherdr status` | Address, process, service, data folder and log. |
| `wherdr logs` (`-f` to follow, `-n 100`) | The log, `~/wherdr/wherdr.log`. |
| `wherdr open` | Opens wherdr in the browser: its tailnet address when published and answering, else `localhost`. |
| `wherdr phone` | Whether your phone can reach wherdr (Tailscale, `tailscale serve`, the address answering), the `tailscale serve` command to publish it when it is not (wherdr then enables the address by itself), the link to **Settings › Phone**, and the QR code once the address answers. |
| `wherdr service install` · `uninstall` | Start at login: a LaunchAgent on macOS (`~/Library/LaunchAgents/dev.wherdr.plist`), a `systemd --user` unit on Linux (`loginctl enable-linger` keeps it running while you are logged out). |
| `wherdr doctor` | Checks Node/Bun, Herdr and its socket, the port, the service, the data folder and `APP_URL`. |

Options: `--port` (default `7683`), `--host` (default `127.0.0.1`, keep it on loopback),
`--data-dir` (passkeys, push keys and settings; default `~/wherdr/data`, the folder the Herdr
plugin and the install script use), `--session` (a named Herdr session). Every
[environment variable](#configuration) works too, and so do `KEY=VALUE` lines in
`~/wherdr/wherdr.env` (for example `APP_URL=…`, read at each start); options win, then the
environment, then that file. `start` and `service install` remember the port and folders for
the other commands.

**Homebrew:** `brew install afloury/tap/wherdr` installs the same package; the first install also
brings Homebrew's Node.js (heavier than the Herdr plugin when Node.js 22 is already there). Then:

1. `brew services start wherdr`: runs `wherdr run` now and at every login, log in
   `$(brew --prefix)/var/log/wherdr.log` (`wherdr logs` reads it).
2. `wherdr open`: the setup guide in your browser.
3. Its Phone step (or `wherdr phone`).

On a Homebrew install, `wherdr start`, `stop`, `restart` and `service install` point to
`brew services` (the installed path changes at each upgrade); `wherdr status` and `wherdr doctor`
show the Homebrew service. Update: `brew upgrade wherdr && brew services restart wherdr`.

The login service records the **absolute path** of the runtime (n, nvm, fnm, Volta or Homebrew
node), since launchd and systemd do not see your shell's `PATH`. It refuses to point at a
temporary `npx` / `pnpm dlx` / `bunx` folder: install the package globally first. To update:
`npm install -g wherdr@latest && wherdr restart` (with `npx`: stop it, then `npx wherdr@latest`).

Bun runs wherdr too (WebSockets, push, passkeys and Herdr's socket work); when Node.js 22 is
also installed, `bunx wherdr` hands the server to Node, the reference runtime. Set
`WHERDR_RUNTIME=bun` to keep Bun.

### From source, no Docker

For development, or to run a checkout of your own (Docker Desktop cannot reach Herdr's Unix socket
on macOS, so wherdr always runs natively there). With Herdr running, Git and Node.js 22 on the
same machine:

```sh
git clone https://github.com/afloury/wherdr.git
cd wherdr
npm ci
npm run build
npm start                  # listens on 127.0.0.1:7683
```

Open `http://localhost:7683` in a browser on that computer: the desktop layout, passkeys and the
installable app work there, since browsers treat `localhost` as secure. There is no phone access
and no push notification in this setup; for that, use the recommended setup (or publish this
instance with `tailscale serve` as above and start it with
`APP_URL=https://server.example.ts.net:7683/ npm start`).

Run it as the user who runs Herdr. It uses `$HOME` and `$HOME/.local/bin/herdr`, or `herdr` from
the `PATH` (Homebrew); set `HERDR_BIN` otherwise. `DATA_DIR` holds passkeys, push data and recent
folders (default `./data`). `npm start` listens on `127.0.0.1` (`HOST`) and port `7683` (`PORT`).
The first-passkey bootstrap token is printed in its output. Keep the process running with your
usual service manager (systemd user unit, launchd, tmux…).

With `APP_URL` empty or `http://localhost:7683/`, wherdr starts normally but disables Web Push
and logs a warning.

### Install as a Herdr plugin

This is what [the one command](#the-one-command) installs; you can also run it yourself, on Linux
and macOS, with Herdr ≥ 0.9.1 (no checks for Herdr or Node.js first). In three lines:

1. Run `herdr plugin install afloury/wherdr`: it installs wherdr, starts it
   (`✓ wherdr is running → http://localhost:7683`) and, at the first install on a computer with a
   screen, opens the setup guide in your browser (`open` on macOS, `xdg-open` on Linux with a
   display; a headless server, or `WHERDR_NO_BROWSER=1` in the environment of the install, just
   prints `http://localhost:7683/#/setup`). Updates open nothing.
2. In Herdr, press **prefix+i** (`ctrl+b` then `i` with the default prefix): the **wherdr** panel,
   with the state, **O** Open wherdr and **P** Set up my phone. The install prints the key it
   chose (see [Panel key](#panel-key)).
3. **P** opens Settings › Phone in the browser: **Make wherdr reachable from my phone** publishes
   it on your tailnet, then the QR code shows once the address answers. Scan it with the iPhone,
   then Share → Add to Home Screen.

Herdr shows the manifest and the commands it will run, then the plugin installs wherdr in
`~/wherdr` and starts it, unless something already answers on the port. If wherdr cannot start,
the install still succeeds and says why; press **S** in the panel once it is fixed. It picks the
setup by itself:

- **Docker** on Linux when Docker Compose v2 works for your user: the published image, from
  `~/wherdr` (`docker-compose.yml`, `.env`), the same files as `WHERDR_MODE=docker` of
  [the one command](#the-one-command).
- **Node.js 22** everywhere else, and always on macOS (Docker Desktop cannot reach Herdr's
  socket): the plugin downloads the prebuilt npm package of its version (or builds wherdr in its
  own folder when that fails), copies it to `~/wherdr/app` and runs it detached from there, with
  its pid and log (`wherdr.log`) in `~/wherdr`. Herdr builds plugins in a temporary folder and
  then moves them, so the server never runs from the plugin folder. Bun works too when Node.js 22
  is missing. Without either, the install stops and says so.

The **wherdr** panel (a Herdr popup) shows ● running / ○ stopped, the local address, the phone
address (with its QR code once it answers), and two main keys: **O** Open wherdr, **P** Set up my
phone (Settings › Phone in the browser). The other keys stay as a fallback: **S** start, **X**
stop, **R** restart, **L** log (Ctrl+C to go back), **U** update (reinstalls the plugin, or pulls
the image in Docker mode), **A** auto-start at login on/off, **Q** quit.

#### Panel key

Herdr plugins have no menu of their own: an action runs from a key or from the command line. The
install therefore appends one marked block to Herdr's `config.toml` (`HERDR_CONFIG_PATH`, or
`~/.config/herdr/config.toml`):

```toml
# wherdr: key that opens the wherdr panel (remove this block to unbind it)
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "afloury.wherdr.panel"
description = "wherdr"
# end wherdr
```

It takes the first key of `prefix+i`, `prefix+u`, `prefix+y`, `prefix+m`, `prefix+alt+w` that
neither Herdr's default keymap nor your config already binds, and prints
`Press prefix+i in Herdr to open the wherdr panel.` Your own lines are never changed. Nothing is
added when a key already runs the panel, when every candidate is taken, or when
`herdr config check` would reject the result. The install then runs `herdr server reload-config`:
keys apply without restarting Herdr. Pick another key by editing the block, or bind the panel
yourself (`command = "afloury.wherdr.panel"`) before installing.

Without a key: `herdr plugin action invoke panel --plugin afloury.wherdr`. The plugin's actions:

| Action | What it does |
|---|---|
| `panel` | The **wherdr** panel (a popup) |
| `open` | Opens wherdr in the browser (its tailnet address when published and answering) |

Up to 1.2.0 the panel action was called `wherdr`: change a key bound to `afloury.wherdr.wherdr` to
`afloury.wherdr.panel` (Herdr has no action aliases; the install warns about such a key and
leaves it alone). Remove the block with `sh scripts/herdr-plugin.sh key uninstall` in the plugin
folder (`~/.config/herdr/plugins/github/wherdr-…`), or delete the lines from `# wherdr:` to `# end wherdr`.

Auto-start: the plugin's startup hook starts wherdr each time the Herdr server starts, which is
all wherdr needs (it drives Herdr). Key **A** adds a login service as well (a LaunchAgent on
macOS, a `systemd --user` unit on Linux, pointing at `~/wherdr/app` with the absolute path of the
runtime): wherdr then runs from login and is restarted if it crashes. It is not installed on its
own because it changes your login session. In Docker mode the container's restart policy does
this job.

Herdr runs the plugin's commands with the environment of its server, whose `PATH` often lacks the
folders of version managers (n, nvm, fnm, Volta, asdf). The install therefore saves the absolute
path of the runtime in `~/wherdr/plugin.env` (`WHERDR_RUNTIME=/path/to/node`); if that binary
disappears, **Start** looks in the usual places (`~/.n/bin`, `~/.nvm`, `~/.volta/bin`, fnm,
`~/.asdf/shims`, Homebrew, `/usr/local/bin`, `~/.bun/bin`) and saves what it finds. Set
`WHERDR_RUNTIME` there by hand for anything else. **Start** only reports success once the
process is alive and the port answers; otherwise it prints the last lines of `wherdr.log`.

Force a setup with `WHERDR_MODE=native herdr plugin install afloury/wherdr` (or `docker`). The
choice, the port (`WHERDR_PORT`, default 7683) and, in native mode, `APP_URL` are kept in
`~/wherdr/plugin.env`; another folder can be set with `WHERDR_DIR` at install time. Nothing is
installed globally and nothing runs with sudo.

When something already answers on the port (a wherdr started with Docker, systemd or by hand),
the plugin starts nothing and never stops it: **Stop** only stops what the plugin started. The
output of the install and of the startup hook is in the plugin logs:
`herdr plugin log list --plugin afloury.wherdr`.

**Uninstall.** Herdr has no uninstall hook, so remove wherdr in this order: in the panel, **A**
(if the login service is on) and **X**; in the plugin folder, `sh scripts/herdr-plugin.sh key
uninstall` (the panel key) and `sh scripts/herdr-plugin.sh skill uninstall`; then
`herdr plugin uninstall afloury.wherdr && rm -rf ~/wherdr` (`~/wherdr/data` holds your passkeys
and push keys).

### wherdr in Docker on a Mac: Reveal in Finder, Open and Mod+Alt+O

The container is Linux: it has no `open` command, so "Reveal in Finder" / "Open" on file paths
and `Mod+Alt+O` (the agent's folder in your editor) do nothing by default — the app reports
"not a Mac". wherdr can ask your Mac to run them over SSH:

```sh
sh scripts/install-host-open.sh          # on the Mac; --user/--target/--port optional
```

This creates a dedicated key pair in `data/` (`host-open-key`), installs
`~/.local/share/wherdr/{reveal.sh,wherdr-open.sh}` on the Mac, loads a small LaunchAgent
(`dev.wherdr.open`, in `~/Library/LaunchAgents`) that launches GUI apps on behalf of the SSH
session, and adds one `authorized_keys` line whose forced command only ever runs the reveal
checks on a path wherdr passes (existing, under your home folder, never an app or a script —
the same rules as a native install).

Then add to `docker-compose.override.yml` and restart the container:

```yaml
services:
  herdr-web:
    environment:
      - HERDR_WEB_HOST_OPEN_TARGET=host.docker.internal   # the Mac as the container sees it
      - HERDR_WEB_HOST_OPEN_USER=<your mac user>
```

Without these variables nothing changes: a non-Mac server refuses with "not a Mac" as before.

The installer picks the editor that opens folders (first of Zed, Trae, Visual Studio Code,
Cursor, Sublime Text, TextMate). Change it any time:

```sh
printf %s "Visual Studio Code" > ~/.local/share/wherdr/editor
```

## Updating

wherdr checks the latest GitHub release at most once a day (an anonymous request to
`api.github.com`, nothing is sent) and shows a small **“wherdr X.Y.Z is available”** banner on the
home screen and in Settings › About, with the release notes and the exact command for your setup.
Hide it until the next version with ×. Set `WHERDR_UPDATE_CHECK=off` to disable the check. The
installed version is shown in Settings › About.

**Update in one tap.** When wherdr runs from the Herdr plugin (Node.js mode), a global npm install
or Homebrew, the banner has an **Update** button instead of the command, for a session opened on
this computer (`localhost`) or unlocked with a passkey. wherdr installs the new version in a
process of its own, restarts, and checks that `/api/health` reports the new version within 60
seconds; the app shows the progress and reloads on the new version. If the new version does not
answer, wherdr goes back to the previous one by itself (the plugin keeps the previous copy in
`~/wherdr/app.prev`, npm reinstalls the previous version, Homebrew points back to the previous keg)
and the app says so. Every step is logged in `~/wherdr/update.log`.

| Setup | What Update does |
| --- | --- |
| Herdr plugin, Node.js | Unpacks the npm package of the new version into `~/wherdr/app`, keeps the old copy, restarts |
| `npm install -g wherdr` | `npm install -g wherdr@X.Y.Z`, then restarts (login service included) |
| Homebrew | `brew upgrade wherdr`, then `brew services restart wherdr` |

Docker shows the command instead: replacing its own container would need the Docker socket (root
on the host) inside it. `npx wherdr` runs from a temporary folder: run `npx wherdr@latest` again.

| Setup | Update command (in the wherdr folder) |
| --- | --- |
| Docker, published image (default) | `docker compose pull && docker compose up -d` |
| Docker, built from source | `git pull && docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` |
| From source | `git pull && npm ci && npm run build`, then restart wherdr |
| `wherdr` command (npm) | `npm install -g wherdr@latest && wherdr restart` (npx: stop it, then `npx wherdr@latest`) |
| `wherdr` command (Homebrew) | `brew upgrade wherdr`, then `brew services restart wherdr` |
| The one command | Run `curl -fsSL https://wherdr.dev/install \| sh` again: it offers the update |
| Herdr plugin, Docker | **U** in the **wherdr** panel (pulls the image, restarts the container) |
| Herdr plugin, Node.js | **U** in the **wherdr** panel, or `herdr plugin install afloury/wherdr --yes` (wherdr restarts on the new version) |

Also run `git pull` now and then with the published image: it brings the latest
`docker-compose.yml` and `.env.example`.

**Build from source.** `docker-compose.build.yml` builds the image locally (`wherdr:local`)
instead of pulling it: add `-f docker-compose.yml -f docker-compose.build.yml` to every
`docker compose` command (and `-f docker-compose.override.yml` if you use one). A build needs
about 2 GB of free memory.

**Automatic updates** (optional). [Watchtower](https://containrrr.dev/watchtower/) can pull new
images and restart the container for you:

```sh
docker run -d --name watchtower --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower --cleanup --schedule "0 0 4 * * *" wherdr
```

Pin a version instead of `latest` with `WHERDR_IMAGE=ghcr.io/afloury/wherdr:1.2.0` in `.env`.

## Install it as an app

The app must be served over HTTPS (see [Requirements](#requirements)). Installed, wherdr opens
in its own window, without the browser's bars.

- **iPhone / iPad** (iOS 16.4 or later): open the address in **Safari** → Share →
  **Add to Home Screen**. Open wherdr from the home screen, then Settings → **Enable
  notifications**. On iOS, push notifications only work in the installed app.
- **Android**: open the address in **Chrome** → menu → **Install app** (or Add to Home
  screen), then Settings → **Enable notifications**.
- **Mac, Safari** (macOS 14 Sonoma or later): File → **Add to Dock**.
- **Chrome, Edge, Brave** (macOS, Windows, Linux): the install icon at the right of the address
  bar, or menu → **Cast, save and share** → **Install page as app** (Edge: Apps → **Install
  this site as an app**).
- **Arc** cannot install web apps
  ([Arc Help Center](https://resources.arc.net/hc/en-us/articles/25678978728983-Does-Arc-for-Desktop-Support-Progressive-Web-Apps)):
  open the address in Safari or Chrome for that, or keep wherdr as an Arc favorite.

Then Settings → Security → **Enable passkey lock** on each device.

## Configuration

All settings are environment variables (`.env` with Docker).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `7683` | Listening port. |
| `HOST` | `127.0.0.1` (`npm start`) | Listening address without Docker. Keep it on loopback. |
| `HOST_LABEL` | server hostname | Name of this machine in the app (can be renamed in the app). In Docker the installer writes the host's short name; left empty, wherdr shows the name Tailscale gives the machine, else `wherdr`. |
| `APP_URL` | *(empty)* | App address and allowed host; a valid HTTPS URL enables Web Push. HTTP, empty or invalid values disable Web Push with a warning. With Tailscale, leave it empty: wherdr adopts the address `tailscale serve` publishes. |
| `TAILNET_REFRESH_MS` | `30000` | How often wherdr reads again what `tailscale serve` publishes for its port. |
| `HERDR_WEB_ALLOWED_HOSTS` | *(empty)* | Additional hostnames or IP addresses allowed to open the app, comma-separated. |
| `PASSKEY_USER` | `wherdr` | User name stored with the passkeys. |
| `DATA_DIR` | `./data` | VAPID keys, push subscriptions, passkeys, recent folders. |
| `HERDR_BIN` | `~/.local/bin/herdr`, else `herdr` in `PATH` | Herdr binary. |
| `HERDR_WEB_SESSION` | *(default session)* | Named Herdr session to drive. Not `HERDR_SESSION`, which Herdr reads itself. |
| `HERDR_WEB_HOST_OPEN_TARGET` | *(unset)* | Docker on a Mac: SSH host that runs Reveal/Open for local panes (see [Docker on a Mac](#wherdr-in-docker-on-a-mac-reveal-in-finder-open-and-modalto)). |
| `HERDR_WEB_HOST_OPEN_USER` | `root` | SSH user for `HERDR_WEB_HOST_OPEN_TARGET` (your Mac user). |
| `HERDR_WEB_HOST_OPEN_KEY` | `data/host-open-key` | SSH private key for the host-open route. |
| `AGENT_KINDS` | all known agents | Agents offered in **New** (only installed ones are shown). |
| `HERDR_WEB_MACHINES` | `on` | `off` to ignore the SSH machines registered in Herdr. |
| `HERDR_WEB_SELF_HOSTS` | | Other names / IPs of this machine, comma-separated (profiles pointing to it are ignored). |
| `HERDR_WEB_REMOTE_SESSION` | | Herdr session to use on every remote machine instead of the profile's. |
| `HERDR_WEB_HERDR_NOTIFICATIONS` | `on` | `off` to stop relaying `herdr notification show` as push. |
| `UPLOAD_DIR` | `~/.cache/herdr-web/uploads` | Where photos sent to agents are stored (deleted after 7 days). |
| `ATTACH_DIR` | `~/.cache/herdr-web/files` | Where other files attached to messages are stored, on the agent's machine (mode 600, deleted after 7 days). |
| `TZ` | `UTC` | Time zone. |

In the app, **Settings** holds per-device preferences: language, theme, notifications, terminal
text size and renderer, typing effect, what the home screen shows, and the passkey lock.

**Settings › Conversation › Reply style** chooses how an agent's reply offers to be quoted in
the field, question by question and point by point (a list item or a paragraph that asks
nothing), so that one message answers them all:

| Style | A question | A point |
| --- | --- | --- |
| **Icon** (default) | A small `↳` after it, in the middle or at the end of the message. | A grey `↳` at its end: on hover on a computer, always there and pale on a phone. |
| **Tap the text** | No button: the question is underlined, tap or click it. | Click it on a computer. On a phone, tap it, then **↳ Discuss**: a single tap never quotes, so reading, scrolling and selecting text stay as they are. |
| **List under the message** | A number after it, and the questions listed under the message. | **+ Quote a point** under the message, then the point. |

Every one of these is a button reachable with the keyboard (`Tab`, then `Enter`), and selecting a
passage still offers **Reply** on it. A quoted question or point shows `✓`.

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
mount. At startup the container creates its user with your `PUID`/`PGID` and `HOST_HOME` as its
home folder, so ssh finds `~/.ssh` there.

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

**Do not disturb** (top of Settings → Notifications) stops every push, for this device or for all
devices, for 1 hour, until 8 am or until turned back on. The server applies it before sending and
keeps it across restarts (`data/quiet.json` for all devices). While it is on, a crossed-out bell
next to Settings on the home screen turns it off in one tap.

wherdr also relays custom notifications sent with `herdr notification show` (plugins, scripts).
To receive them it connects to Herdr's client socket as a **passive** client: it never becomes
the foreground client and never resizes anything. Side effects: with wherdr connected,
`notification show` reports `shown: true` even with no terminal attached, and an empty session
gets a default workspace, as with any attached client.

## Works great with herdr-projects

[herdr-projects](https://github.com/eliasstravik/herdr-projects) is a Herdr plugin that runs a
project as one **coordinator** conversation and parallel **threads**, each in its own Git
worktree. It is optional; with it installed, wherdr adds:

- **Project groups** in the agent list: the coordinator first, its threads indented under it,
  grouped by repository (`Repo web-shop · 2 worktrees`), with their thread number and state.
- **Project panel** next to the coordinator (a side panel on a computer, a tab on a phone). It
  reads the project's `TASKS.md` and shows the lists it has, always in this order, with the open
  threads live (state, progress, report) and resolved threads under Done:

  | List | Meaning | Buttons |
  | --- | --- | --- |
  | **To test** | You confirm the work | Confirm, Problem, Question |
  | **To decide** | Only you can unblock it | Question, Answer |
  | **To review** | Pull requests for you | Reviewed, Comment |
  | **In progress** | What threads are really doing | (live threads) Add info |
  | **In queue** | Decided: the coordinator launches the first one as soon as a thread slot frees | Move up / down, Launch now, Clarify, Remove from queue |
  | **Blocked** | Waiting for someone or something external | Unblock, Clarify |
  | **To do** | To do soon, in your priority order; never launched on its own | Move up / down, Queue it, Launch now, Clarify, Back to backlog |
  | **Backlog** | Everything else | Launch, Clarify |
  | **Done** | Resolved threads | |

  Every list is **optional**: you and your coordinator pick the ones a project uses (a small
  project may only need Backlog, In progress and Done); any other `##` list shows in a neutral
  style after Backlog. French titles and common synonyms are recognized (À tester, En file,
  À faire, Plus tard…). Every button sends a ready-made message to the coordinator, which edits
  `TASKS.md` (wherdr never writes it). **Add info**, on a working thread, opens a text field:
  what you type goes to the coordinator, which passes it on to that thread as is. The In queue
  header shows the thread slots in use (`max_parallel_threads` in `PROJECT.md`) and the next
  task, plus the machine's global limit when one is set
  (`2 of 2 thread slots in use on <machine> (all projects)`).
- **Max threads per machine**, across all projects: herdr-projects only limits threads per
  project, so three coordinators could still start a dozen threads on one small machine. Set a
  limit per machine in **Settings → Plugins → herdr-projects** (empty `—` = no global limit;
  saved on the server, in `data/thread-limits.json`). wherdr counts the active threads of every
  project from the live panes (herdr-projects marks each open thread's pane): a thread whose agent
  has finished (idle or done, waiting for review or for you) gives its slot back right away; one
  started less than 3 minutes ago still counts while it waits for its brief. wherdr writes
  `.wherdr-limits.json` in each herdr-projects folder where a coordinator runs, refreshed on
  every change:

  ```json
  { "updated": "…", "this": "Server", "machines": { "Server": { "max": 2, "open": 2, "free": 0, "threads": ["shop/t-0012", "docs/t-0003"] } } }
  ```

  The coordinator rules (Settings) tell the coordinator to read it before starting a thread and
  to wait while `free` is `0`, even if its project still has slots; In queue tasks start when the
  machine has a free slot. `herdr-projects overview` is the fallback when the file is missing.
  The same data is available read-only at `GET /api/plugins/thread-limits`.
- **Badges**, the only decoration on task lines, chosen by the coordinator (wherdr adds none
  on its own): `[b:color(text)]`, or `[b:color(text)](target)` for a clickable badge with a small ↗.
  The target is an `https://` / `http://` link (new tab) or a thread ID such as `t-0140` (opens
  its tab); any other scheme is ignored. Color is `red`, `orange`, `amber`, `green`, `teal`,
  `blue`, `violet`, `pink`, `gray` (theme-aware), a `#rgb` / `#rrggbb` hex, or empty for neutral;
  at most 24 characters are shown. A bare URL in the text shows as a plain link, and the owner
  `(me)` / `(agent)` is read but not shown. The coordinator rules (Settings) tell the coordinator
  to use badges on its own when they help (status, thread, PR, device, priority…), sparingly,
  and to follow your preferences. Example:

  ```markdown
  - [ ] Stop button on iPhone [b:red(bug)] [b:gray(t-0140)](t-0140) [b:blue(PR #12)](https://github.com/owner/repo/pull/12) (me)
  ```
- **Settings → Plugins → herdr-projects**: install status per machine, the `TASKS.md` convention,
  a template, the max threads per machine and the coordinator rules to copy.
- **Projects entries** in the menus when the plugin is on the agent's machine: an agent's menu
  (`…`) and its card's (right click, long press on the phone) offer the Project panel, **New
  project…**, **Continue as a project…** (an agent outside a project), **Pause this project…**
  and **Check herdr-projects setup**; the project's header in the list has its own menu with
  the same entries. Shortcuts: `Mod+Alt+P` (Project panel) and `Mod+Alt+Shift+N` (New project).
  The plugin's other actions stay under **Plugin actions**.
- **New project** with the same machine and folder picker as **New agent**, and the agent
  profiles of its coordinator and threads (see [Herdr plugins](#herdr-plugins)).

<p align="center">
  <img src="docs/screenshots/project-panel.png" alt="A coordinator with the Project panel open, and its project group with threads in the sidebar" width="900">
</p>
<p align="center">
  <img src="docs/screenshots/project-phone.png" alt="The Project panel on a phone" width="340">
</p>
<p align="center"><sub>A coordinator with its Project panel, on a computer and on a phone (demo data).</sub></p>

### Using wherdr with herdr-projects

The Project panel only works well when the coordinator follows its conventions: which lists
mean what, the badges, `(agent → t-NNNN)`, and what to do with each message the buttons send
(`✓ Tested: …`, `✗ Problem: … — …`, `↳ Queue: …`…). They are written once, as an agent skill:
[`skills/wherdr/SKILL.md`](skills/wherdr/SKILL.md).

- **Herdr plugin**: the install links the skill for every coordinator, whatever its agent:
  `~/.claude/skills/wherdr` (Claude Code, or `$CLAUDE_CONFIG_DIR/skills`) and
  `~/.agents/skills/wherdr` (Codex, omp), each only when that agent is installed. Both point to a
  copy in `~/wherdr/skills/wherdr`, refreshed on each update. An existing `wherdr` skill that is
  not this link is left alone. Remove the links with `sh scripts/herdr-plugin.sh skill uninstall`
  in the plugin folder.
- **Other installs**: link or copy `skills/wherdr` into your agent's skills folder yourself, or
  paste **Settings → Plugins → herdr-projects → Copy rules for the coordinator** to it.

## Herdr plugins

Actions declared by the plugins installed on a machine (`herdr plugin install|link`) appear in
the menus: workspace / tab / pane actions in the agent menu, global actions in the machine menu.
wherdr always passes the agent's pane explicitly. It asks for confirmation before running an
action, except for actions that only show or check something (list, show, status, doctor…).
Actions that open a plugin pane or popup open it in the attached Herdr terminal client, not on the
phone: the menu marks them **Opens in Herdr**. wherdr's own plugin actions (its panel, open in the
browser) are not listed. With a single machine, the machine's actions are in the **…** menu of
its session row, under the agent list header.

**herdr-projects** actions that ask for input (New project, continue this workspace as a
project, open, pause, resume) are run by wherdr itself as `herdr-projects` commands, because
Herdr's API cannot pass them arguments. **New project** picks its repository like **New agent**
picks a folder: the machine (when the project is created from this machine, a repository on an
SSH machine is passed as `PATH@MACHINE`), a folder browser and recent folders. It suggests the
root of the current space's Git repository (nothing outside a repository, never your home
folder itself), offers the root when you pick a subfolder, and names the project after the
repository. It also asks which agent profile runs the **coordinator** and which one the
**threads** start with: the profiles of the project's machine (`herdr-projects profile list`:
yours and the signed-in built-ins such as Claude or omp) that the plugin allows for each role,
with the plugin's defaults for new projects selected (or the first profile listed, when a default
is not available there). The choice is written to the project's
`PROJECT.md` (`coordinator_profile`, `thread_profile`); with a herdr-projects without profiles,
the choice is not shown.
With Docker, these commands write to the projects folder, so `docker-compose.yml` mounts
`~/.herdr-projects` read-write. If you set another `root` in
`~/.config/herdr-projects/config.toml`, mount that folder instead (same path on both sides);
otherwise wherdr reports that the home folder is read-only. Check setup only reads; the other
actions (Configure…) run on the host through Herdr, as in the terminal client. When no herdr-projects
ticker is running yet, the one these commands start inside the container is stopped right away;
the next `herdr-projects` command run on the host (a coordinator starting a thread, Herdr
starting) starts it there.

## Security

wherdr drives Herdr, so **it can run anything as your user**. Docker does not change that: the
container talks to the Herdr server running on the host.

- It listens on `127.0.0.1` only. Reach it from other devices **only through a private
  network** (Tailscale or [equivalent](#other-private-networks)). Never add a public route
  (port forwarding, public reverse proxy, ngrok…); the only exception is a Cloudflare Tunnel
  behind Cloudflare Access, with its risks.
- Requests are accepted only for `localhost`, loopback addresses, the runtime's hostname, the
  hostname in `APP_URL`, the tailnet name `tailscale serve` publishes for wherdr's own port
  (read from Tailscale on the machine, never from a request, and only while it is published),
  and the runtime's network interface addresses (those of the container
  with Docker). Add other private names or IP addresses to `HERDR_WEB_ALLOWED_HOSTS`
  (comma-separated) before using them. An unlisted name returns HTTP 403 (`host` / "Host not
  allowed"); add it to `HERDR_WEB_ALLOWED_HOSTS`, then restart wherdr. This host check also
  applies to WebSockets.
- **Passkey lock** (Settings → Security, recommended): once a passkey is registered, the API,
  images, photos and WebSockets require an unlocked session (signed HttpOnly cookie). Two limits
  apply:
  - **12 hours without use**: the session slides, so the app only locks again after 12 hours
    without any request (or when you lock it from Settings).
  - **Maximum duration** since the last passkey unlock, set in Settings → Security for every
    device: 1 day, 7 days (default), 30 days, 90 days or 1 year. The unlock time is signed in the
    cookie and the slide never moves it. Past it, the device asks for the passkey again at the
    next opening of the app (launch, reload, or back in the foreground), never in the middle of
    use; the app warns in the last hours. A client that never reopens is cut 12 hours after the
    deadline. A shorter duration applies to the sessions already open.

  A network error or a server restart never locks the app. **Lock all devices** (Settings →
  Security, for a lost or stolen device) ends every session, this one included, and keeps the
  passkeys: each device unlocks again with its own. Turning the lock off removes the passkeys and
  invalidates every session. Lost passkey: delete `data/auth.json` on the server; the app is open
  again to whoever can reach it.
- <a id="new-device"></a>**New device**: it can only get in with an existing passkey. Unlock it
  with a passkey synced by your password manager (iCloud Keychain, Google Password Manager,
  1Password…), or with the passkey of another device through the browser's "use a phone or
  tablet" QR code, then Settings → Security → **Add this device** to give it its own passkey.
- Without a passkey, **anyone who can reach the address can control your agents**: every device
  on your tailnet, and every user of your tailnet if you share it.
- Writes require `Content-Type: application/json` (or `image/*` for photos, `application/octet-stream` for attached files) and an `Origin`
  matching the host, WebSockets included. API reads sent from another site (links, images,
  `no-cors` fetches, reported by the browser's `Sec-Fetch-Site`) are refused too.
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
  was installed, or it is not Claude Code / Codex / omp. Install the integration
  (`herdr integration install claude|codex|omp`) and start a new agent.
- **Passkeys or notifications unavailable**: the page must be served over HTTPS (or
  `localhost`). On iPhone, notifications need the app installed on the home screen.
- **HTTP 403 "This address isn't enabled yet"**: for a tailnet address, run the command the
  page gives on the machine: it tells whether `tailscale serve` publishes wherdr's port there.
  For another private name, add the hostname or IP address to `HERDR_WEB_ALLOWED_HOSTS`, or use
  the hostname in `APP_URL`, then restart wherdr.
- **Remote machine offline**: `docker compose logs | grep machine` shows its state. Test SSH as
  wherdr does, from the container:
  `docker compose exec herdr-web ssh -o BatchMode=yes laptop '~/.local/bin/herdr status server'`.
  - `Could not resolve hostname`: container DNS (use the full name in `HostName`);
  - `Permission denied (publickey)` / `Host key verification failed`: key or `known_hosts`
    (run `ssh laptop true` once on the server);
  - `Bad owner or permissions`: `~/.ssh/config` must belong to you and not be group-writable.
- **Claude says "Not logged in" on a Mac** whose Herdr server was started over SSH: the macOS
  keychain is locked in SSH sessions. Start the Herdr server from a terminal on the Mac.
- **`Session open refused by peer` / `Connection closed by UNKNOWN port 65535`** in the logs: the
  shared SSH connection to a remote machine reached sshd's session limit (`MaxSessions`, 10 by
  default). wherdr stays under it and retries, so this is rare; if it persists (many terminals
  open at once), raise `MaxSessions` in the remote machine's `sshd_config`.
- **Quotas missing**: see [Claude and Codex quotas](#claude-and-codex-quotas).
- **iPhone layout cut at the bottom** after changing the status bar style: reinstall the home
  screen icon (iOS reads this setting at install time).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

Every commit is public: a leak check (gitleaks plus your own forbidden patterns) covers the files
and the commits about to be pushed; see [Leak check](CONTRIBUTING.md#leak-check).

## License

[MIT](LICENSE). The embedded font subsets keep their own licenses (`app/assets/fonts/`).
