# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **The tailnet address enables itself**: wherdr reads what `tailscale serve` publishes on its
  machine (at startup, every 30 seconds, and when an address it does not know is opened) and
  adopts the HTTPS address that points to its own port: allowed host and `APP_URL`, with no
  visit to Settings › Phone, so a server without a screen works too. An address removed from
  `tailscale serve` is refused again. In Docker, wherdr reads Tailscale's socket, mounted by the
  new `docker-compose.yml` (`/var/run/tailscale`; it gives the container Tailscale's local API
  with the host user's rights, see the README, and can be removed); the address it suggests now
  carries the machine's name, not the container's. Nothing a request sends can enable an
  address, and one that `tailscale funnel` opens to the Internet is never adopted.
- **The installer sets the phone up in Docker**: it offers to run `tailscale serve` (asked
  first), hands the address to wherdr and waits for it to answer. Run again later, it checks the
  phone address of the wherdr already installed.
- **Update in one tap**: with the Herdr plugin (Node.js mode), a global npm install or Homebrew, the
  "wherdr X.Y.Z is available" banner (home screen, Settings › About) has an **Update** button, for
  a session on this computer or unlocked with a passkey. wherdr installs the new version in a
  detached process, restarts, and waits for `/api/health` to report it; the app shows an
  Updating screen and reloads on the new version. A version that does not answer within 60 s is
  rolled back by itself (previous plugin copy, previous npm version, previous Homebrew keg), and
  the app says "Rolled back to X.Y.Z". Log: `~/wherdr/update.log`. Docker and npx keep showing
  the command.
- **Browser demo at [wherdr.dev/demo](https://wherdr.dev/demo/)**: the real app, built with
  `npm run build:demo` (static, no server), on scripted agents that run in the page — two
  projects, Claude Code, Codex and omp in different states, a split with a dev server, the Project
  panel, diffs, terminals. Sending a message gets a scripted answer, sometimes after an
  Approve / Deny card. Nothing runs: `fetch` and `WebSocket` are answered in the browser and every
  other request is refused. Linked from the top of the site and of this README.
- **Long pasted text as a card**, like Claude Desktop: a pasted log or long text (more than 12
  lines or 1,500 characters) shows as a "Pasted text · N lines" card under the message, with its
  first lines. A tap opens the whole text in a scrolling window (a sheet on the phone), in a
  monospace font for a log, with **Copy**. Pasting such a text into the message field adds the
  card instead of filling the field; it can be removed, and is sent to the agent as it is.
  Claude's `<pasted_content>` blocks are recognized; for Codex and omp, the texts pasted from
  this device are.
- **Long typed messages fold** after about 12 lines, with a fade and **Show more / Show less**.
- **Continue on the tailnet address**: a passkey only works on the address it was created on.
  When wherdr's tailnet address is published and answers, the setup guide opened on `localhost`
  shows a **Continue on <machine>.<tailnet>.ts.net** button that reopens it at the same step
  there (`#/setup?step=…`), and the passkey card (guide and Settings › Security) sends the lock
  to that address. No automatic redirect. The Herdr plugin (first install, **Open**),
  `wherdr open` and the installer's summary use that address too when it is already published,
  and `wherdr phone` makes wherdr adopt an address published by hand (`APP_URL`).

### Fixed

- **"This address isn't enabled yet" (403) on a server without a screen**: the page no longer
  only says to open wherdr on the computer. It gives the command to run on the machine
  (`wherdr phone`, or the installer again for Docker and the Herdr plugin), and the address is
  now enabled without it in the usual case (see above).
- **Phone address checks** (`wherdr phone`, the installer, the plugin) ask `/api/health`, which
  goes through the host check, instead of the static manifest, which answers for any host name:
  an address wherdr refuses is now reported as refused, not as answering.
- **Setup guide and Settings › Phone opened on the tailnet address**: they show that address and
  its QR code instead of asking to open `http://localhost:7683`.
- **Project panel**: opening it with the board already loaded (reopening a coordinator) no longer
  breaks it with "Cannot access … before initialization".

### Changed

- **Setup guide for agents** (`https://wherdr.dev/agent.md`): a third of its size, so fetch
  tools return it whole (it also says how to read the raw file). The agent detects what is
  installed before asking (wherdr, herdr-projects, Tailscale), sets the phone address through
  wherdr instead of editing `plugin.env`, offers no login service to a plugin or Homebrew
  install, and finishes on the tailnet address: passkey with the bootstrap token, then the phone.
- **Settings › Appearance › Theme**: the theme list is split into three titled sections —
  wherdr (Titanium first), Agents (Claude Code, Codex, omp, omp Light) and Herdr (Follow Herdr,
  herdr.dev and Herdr's built-in themes). Each theme carries its section in `app/utils/themes.ts`.

- **Website install section**: three tabs side by side — curl (the one command, selected by
  default), Package managers (Homebrew, npx, bunx, pnpm dlx) and Herdr plugin — above the
  "Ask your AI agent" card, instead of a folded "Other ways" block. The Docker-by-hand tab is
  gone from the site; Docker stays documented in the README and through `WHERDR_MODE=docker`.

## [1.3.1] — 2026-10-08

### Added

- **One install command for macOS and Linux**: `curl -fsSL https://wherdr.dev/install | sh` now
  checks Herdr (and links https://herdr.dev when it is missing), then installs the wherdr Herdr
  plugin: wherdr in `~/wherdr`, started now and with Herdr, its setup guide opened in the browser
  and **prefix+i** for its panel. On a Mac without Node.js 22 it offers `brew install node`; on
  Linux, Docker works too. A wherdr that already runs is never replaced: the script says so and
  offers its update; a `wherdr` container managed from another folder is never touched. On a
  server without a screen (or over SSH) it opens nothing and prints the address, an `ssh -L`
  tunnel and the phone steps. `WHERDR_MODE=docker` keeps the previous Docker Compose setup.
- **Herdr plugin**: `WHERDR_NO_BROWSER=1` in the environment of the install opens no browser.

- **Homebrew**: `brew install afloury/tap/wherdr`, then `brew services start wherdr` runs it now
  and at every login, and `wherdr open` opens the setup guide. The first install also brings
  Homebrew's Node.js. A Homebrew install shows `brew upgrade wherdr` in the update notice. Each
  version tag updates the formula in `afloury/homebrew-tap` when the `HOMEBREW_TAP_TOKEN` secret
  is set.
- **Animated packets** switch under Settings › Appearance › Desktop › Background › wherdr grid
  (on by default): off, the dotted grid stays still. Saved on the device.
- **Install it as an app**: README section and website block on installing the PWA from Safari
  (iPhone, Mac), Chrome, Edge, Brave and Android; Arc cannot install web apps.

### Changed

- The agent list header shows the wherdr server version next to Herdr's
  (`WHERDR 1.3.1 · HERDR 0.9.3`); a tap opens Settings › About.
- The plugin button left the agent list header: with a single machine, plugin actions are in the
  **…** menu of the machine's session row. wherdr's own plugin actions are no longer listed, and
  actions that open a pane or popup in Herdr say **Opens in Herdr**.

### Fixed

- **A pane gets its size back when wherdr's terminal closes.** Opening the terminal on a phone
  resizes the real pane to about 40 columns, and with no Herdr client attached to lay it out
  again (a machine driven from afar) it stayed that narrow: the agents' screens were cut (omp's
  model selector, its status line without the model…). wherdr now remembers the pane's size when
  its first terminal opens and gives it back when the last one closes — after 2 seconds, or
  30 seconds after a connection that dropped (locked phone, lost network), so a terminal that
  comes back keeps its size. A size set meanwhile by an attached Herdr client is left alone, and
  the sizes to give back survive a restart of wherdr. The width is read from the pane's PTY;
  in Docker, where it is out of reach, the pane gets the width of Herdr's layout.

- **Claude Code settings card (`/usage`, `/status`, `/config`, `/stats`)**: recent Claude Code
  versions draw the settings panel with a key legend, so wherdr took it for an interactive menu
  and showed its text squashed on one line. The card is back: tabs read from the screen (Stats
  included, robust to a tab more or less), active tab highlighted, usage gauges with their reset
  time (an empty 0 % gauge too), the rest as readable lines without the keyboard help.
- **Stop on a Claude Code `!` command**: Claude puts the cancelled command back into its input
  field (shell mode), which kept every following message "Queued · will be sent when the agent's
  input is free". From the conversation, Stop now empties Claude's field when it holds exactly
  the command wherdr sent, and the command comes back into wherdr's field, like an interrupted
  prompt.

- **Stop on an omp `!` / `$` command**: the cancelled command no longer comes back as
  "Queued · sending…" (then "Not sent"). omp writes nothing for it before the first prompt of a
  session; seeing the run on omp's screen is now enough to take the message off the queue.

- **`wherdr` command on a Homebrew install**: `status` and `doctor` show the Homebrew service
  (`brew services`) instead of "started another way" / "not installed"; `logs` reads its log
  (`$(brew --prefix)/var/log/wherdr.log`); `start`, `stop`, `restart` and `service install` point
  to `brew services start|stop|restart wherdr`.

- **Interface language**: without a saved choice, wherdr follows the browser's first preferred
  language it speaks (English when English comes first), instead of switching to French whenever
  French is anywhere in the list.

- **No "New version available" banner right after an install or update**: a service worker left
  by a previous install on the same address, or a new version deployed while the app was closed,
  is now activated silently when the page opens (the page already runs the new build). The banner
  only appears for an update that arrives while the app is in use, so nothing being typed is lost.

## [1.3.0] — 2026-10-08

### Added

- **Herdr key for the wherdr panel**: the plugin install appends one marked `[[keys.command]]`
  block to Herdr's `config.toml` on the first free key of `prefix+i`, `prefix+u`, `prefix+y`,
  `prefix+m`, `prefix+alt+w` (never one Herdr or your config already binds), reloads Herdr's
  config and prints `Press prefix+i in Herdr to open the wherdr panel.` The panel shows the key;
  `sh scripts/herdr-plugin.sh key uninstall` removes the block.

- **Other private networks** (README): wherdr works with any private network that gives it an
  HTTPS address with a valid certificate. Headscale, NetBird, ZeroTier and WireGuard use a
  reverse proxy on the private address (Caddy, certificate from the DNS challenge) and `APP_URL`;
  Cloudflare Tunnel only behind Cloudflare Access, with an explicit warning. Settings › Phone
  links to it ("Using something else?"), and so do wherdr.dev, `llms.txt` and `agent.md`.
- **Setup guide** at first launch, a centered modal over the blurred app on a computer, full screen on a phone: what wherdr is, the
  Herdr version and the agents found on this machine (or how to start one), the phone
  (Settings › Phone's Tailscale setup), then the passkey lock and notifications. Skip is always
  there; finishing or skipping is saved on the server (`data/onboarding.json`, tied to the
  machine), so other devices do not show it again. Reopen it from Settings › About. A phone
  already on the tailnet address gets Add to Home Screen (iOS and Android) instead.
- Settings › Phone: Check, Check again and publishing now show their result next to the button,
  with the time of the check: "Reachable", or the precise cause (address not found, connection
  refused, timeout, invalid certificate, no HTTPS on the port, not https://, something else
  answering with its HTTP status). The state rows flash when refreshed. In Docker, the
  `tailscale serve` command keeps the HTTPS port of an address already published on another port.
- The Herdr plugin opens the setup guide in the browser at the end of the first
  `herdr plugin install` (`open` on macOS, `xdg-open` on Linux with a display); updates and
  headless servers open nothing, the address is printed.
- wherdr.dev: the Install section recommends a method for the visitor's system (macOS: the Herdr
  plugin; Linux: the install script) and lists the prerequisites (Herdr, Tailscale for the phone).
- **Settings › Phone** ("Use it on your phone"): live state of the phone address, checked by the
  server. Native mode: **Make wherdr reachable from my phone** runs `tailscale serve` (asked
  first; private to your tailnet), **Remove from my tailnet** undoes it. Docker: the exact
  command with Copy, then the address it printed, checked through Tailscale's DNS. Once the
  address answers, wherdr sets `APP_URL` to it (`data/app-url.json`, no restart; an HTTPS
  `APP_URL` in the environment wins) and only then shows the QR code. Known Tailscale errors
  (HTTPS certificates off, Linux operator rights, not connected, port used by another service)
  are explained with a link. Only for this computer (localhost, not through a proxy) or an
  unlocked session.
- The Herdr panel is reduced to the state, **O** Open wherdr and **P** Set up my phone (opens
  Settings › Phone); the other keys stay as a quieter fallback. `wherdr phone` prints the real
  state and that page's link. The QR code is never shown for an address that does not answer.
- `wherdr` agent skill (`skills/wherdr/SKILL.md`) for herdr-projects coordinators: the
  `TASKS.md` lists and badges the Project panel reads, `(agent → t-NNNN)`, and what to do with
  each message its buttons send. The Herdr plugin links it into `~/.claude/skills` and
  `~/.agents/skills` (Codex, omp) when those agents are installed, never over a foreign skill;
  `herdr-plugin.sh skill uninstall` removes the links.
- npm package `wherdr`, prebuilt: `npx wherdr`, `bunx wherdr` or `pnpm dlx wherdr` runs it
  without cloning or building. Installed globally (`npm install -g wherdr`), the `wherdr` command
  also has `start` / `stop` / `restart` / `status` (background server, pid and log in `~/wherdr`;
  *started* only once the port answers, otherwise the end of the log), `logs [-f]`, `open`,
  `phone` (tailnet address, `tailscale serve` command, QR code), `service install|uninstall`
  (macOS LaunchAgent or `systemd --user` unit with the absolute runtime path) and `doctor`.
  Published by `.github/workflows/npm.yml` on each version tag (npm Trusted Publishing). The
  website's install section adds npx, bunx and pnpm dlx tabs.
- Herdr plugin: `herdr plugin install` (exact command in the README) now starts wherdr at the end of the install
  (`✓ wherdr is running → http://localhost:7683`), or says why it could not without failing the
  install. One **wherdr** action opens a panel: state, local and tailnet addresses, version, mode,
  auto-start, the phone QR code, and keys S start, X stop, R restart, O open, L log, U update,
  A login service on/off, P phone setup, Q quit (also `wherdr panel`). In native mode wherdr runs
  from `~/wherdr/app`, which outlives Herdr's temporary build folder and plugin updates. The other
  actions are gone, except **wherdr: open in the browser**. The README and the website give the
  three-step path and how to uninstall (Herdr has no uninstall hook).
- `WHERDR_SERVICE_NAME` names the login service (LaunchAgent `dev.<name>`, unit `<name>.service`)
  for a second wherdr next to the usual one.
- Herdr plugin: wherdr installs with `herdr plugin install` (`herdr-plugin.toml` at the root; exact
  command in the README). It runs the published Docker image on Linux when Docker Compose works, Node.js
  22 otherwise (always on macOS), from `~/wherdr`; starts wherdr detached with Herdr unless
  something already answers on its port; and adds Start, Stop, Restart, Status, Open, Update and
  Phone setup actions. Stop only stops what the plugin started. The website's install section
  lists it as its second method, after the one-line installer.
- Settings › Conversation › Quoted replies is now a choice of how the field shows the quotes, per
  device (computer and phone): "“>” lines" (plain text, default), "Tokens, native field" (the
  plain field, its quote lines drawn as tokens: typing, dictation and autocorrect unchanged) or
  "Tokens, rich field"; both token options are marked experimental. The preview shows the chosen
  option; a former switch turned on keeps the rich field.
- Chat: images an agent's tool returned (omp `read` of a PNG, a screenshot, Claude `Read`,
  Codex `view_image`) show as thumbnails under the action, even when the action block is
  folded, and open in the image viewer. An image already shown higher up (a photo you sent that
  the agent reads back, even re-encoded, or the same bytes read twice) shows as a small
  "↑ Same image as above" link instead, which opens it in the viewer.
- Settings › Appearance › Desktop (computer only): Background "wherdr grid" (default) shows the
  website's dotted grid with light packets in the margins of the conversation; "herdr grid" keeps
  the flat line grid. Content width moved here from Settings › Desktop. Phones show no grid.
- Component tests (Vue components mounted in a Nuxt environment) and end-to-end tests in
  Chromium and WebKit, at iPhone and desktop sizes, against a fake Herdr server.
- GitHub Actions CI on pushes and pull requests to `main`: unit, component and end-to-end tests,
  type check and leak check.
- herdr-projects New project: choose the agent profile of the coordinator and of the threads
  (Claude, omp, your own profiles…) among those the plugin allows on the project's machine,
  with the plugin's defaults for new projects selected, names shown as written. Written to the
  project's `PROJECT.md`.
- herdr-projects shortcuts and menu entries, where the plugin is on the agent's machine:
  `Mod+Alt+P` shows or collapses the Project panel of the current agent's project (opens the
  coordinator from a thread), `Mod+Alt+Shift+N` opens New project. Agent menus, agent cards and
  the project's header in the list get a Projects section: the Project panel, New project…,
  Continue as a project…, Pause this project… and Check herdr-projects setup.

### Changed

- **Plugin action renamed** `wherdr` → `panel` (`afloury.wherdr.panel`). Herdr has no action
  aliases: change a key bound to `afloury.wherdr.wherdr`; the install warns about one.

- Quoted replies as tokens in the field are marked experimental and are now off by default on a
  computer too (Settings › Conversation › Quoted replies).
- The crossed-out bell of the agent list (do not disturb on) now opens Settings › Notifications
  instead of turning notifications back on at once.

### Fixed

- omp: changing the model from the field no longer fails with "omp's model selector did not show
  up" when the pane is narrow (left at the phone terminal's width, typical of an SSH machine
  with no Herdr client attached). omp then cuts the model ids and the footer; wherdr now widens
  the pane for the time of the choice and gives it its width back, or says the terminal is too
  narrow (wherdr's terminal still open). omp's `ascii` symbol preset is read too.

- Settings › Phone right after publishing: while Tailscale gets the HTTPS certificate (timeout,
  TLS error or refused connection during the first 90 seconds), the address shows a loader,
  "Getting the HTTPS certificate from Tailscale…", and is checked again every 4 seconds, instead
  of a red error under green rows. The result next to the button now follows the same state as
  the rows, and the QR code only appears once the address really answers. A published address is
  allowed as a host at once, so the first scan never lands on "Host not allowed".
- A browser opening an address wherdr does not allow yet now gets a short page in English and
  French saying what to do, instead of raw JSON; API requests keep the JSON error. The page
  reveals neither the allowed hosts nor APP_URL.
- Agent list header: with plugin actions and do not disturb on, the last buttons were cut off in
  a narrow sidebar. The title now shrinks first, then the plugin, settings and bell buttons move
  into a “…” menu as needed.
- Herdr plugin, native mode (macOS): Start failed when Herdr's server `PATH` did not contain
  node (n, nvm, fnm, Volta…) yet said “started”. The install now saves the absolute path of node
  (or Bun) in `~/wherdr/plugin.env` (`WHERDR_RUNTIME`), Start looks in the usual folders when it is
  gone, and reports success only once the port answers, with the end of the log otherwise. The
  install downloads the prebuilt npm package of its version when it exists instead of building.
- Claude Code's `/config`, `/status` and `/usage` results highlight the active settings tab again:
  the tab Claude Code now draws in reverse video (seen under Herdr 0.9.3) is recognized.
- Remote (SSH) machines: busy machines no longer show "Connection closed by UNKNOWN port 65535",
  "Conversation not up to date" or "Threads unavailable". wherdr keeps its reads under sshd's
  session limit per connection (`MaxSessions`, 10 by default), leaving room for terminals,
  shares identical reads already running and retries a refused session. A quota read that fails
  no longer shows "not set up / Install": the last reading stays, as do the project's threads.
- omp with nerd-font or ascii symbols (`symbolPreset`): a running `!` command shows the Stop
  button again, and Stop or Escape cancels it; the working step, the tool approval dialog and the
  model selector are read with every symbol preset.
- An action waiting for its approval no longer shows the finished-turn line ("✓ 2 s · 1 action"):
  it stays in progress until it is approved.
- Phone: bottom sheets (the "…" menu, confirmations, command and plugin results) close with a
  tap on their handle or a swipe down from the handle, the title or the list scrolled to its top;
  they stop at 85 % of the screen height, leaving room above to tap outside.

- A long "!" command sent to Claude Code no longer also stays below as a "Queued" bubble while it
  runs: the screen wraps it (mid-path), and the wrap no longer hides that it is the same command.
  Codex "!" commands now show as command blocks with their output, and their bubble goes away.
- "/" menu of the input field: on an SSH machine, the skills and commands (user and project)
  are read in one SSH session instead of one per folder and file, a refused session is retried
  once, and if they still cannot be read the built-in commands show (asked again on the next
  "/") instead of no menu at all.

- omp: a new conversation (no message yet) now shows its model and effort in the field, read
  from omp's status line, and both can be changed from there. After a turn, "auto" shows the
  level omp picked ("auto · low", and "This turn: low" in the menu) instead of a bare "auto".
  The model selector also works with omp's nerd-font symbols and its 18.6 Task-model toggle.

- Messages sent to omp while it shows a tool approval dialog ("Allow tool: eval", bash, MCP…)
  are no longer typed into the dialog and lost (their Enter could even approve the tool): typed
  replies and Project panel buttons (Reviewed, Tested, Launch, Unblock…) are held and delivered
  once the dialog is answered and omp's input field is back.
- omp's tool approval now shows in Conversation as a "Your turn" card: the tool, its full input
  (folded when long) and the dialog's buttons (Approve, Deny…), instead of "details in the
  Terminal tab".
- The model and effort under the input field no longer turn into a bare "Model" when reading the
  transcript briefly fails (SSH machine connection dropped, timeout): the last known value stays.
- An omp `!` or `$` command sent while omp is working no longer stays "Queued · sending…" (then
  "Not sent", inviting a second run): omp runs it at once but records it only when the next prompt
  starts, so its bubble now goes when that turn ends; the "You ran" block shows once omp records it.
- Pasting an image (`⌘V` on a Mac) into a terminal, full view or side by side, now reaches the
  agent: it is uploaded to the agent's machine and its path pasted through Herdr, which omp and
  Claude Code attach as an image. Before, the terminal only pasted text and the image was lost.
- The installed app no longer opens on a blank screen when its server accepts the connection but
  never answers (a phone on a tailnet whose wherdr host is gone): it shows the app from its cache
  after 3 s, then the last known state, and goes live once the server answers again.

## [1.2.0] — 2026-10-05

### Added

- Full omp conversations: transcripts, reasoning, tool actions and results, status line,
  questions, slash commands, shell commands, model and thinking controls, restart, and branding.
- wherdr Titanium, Graphite and Neon Purple themes, plus omp themes and a configurable animated
  composer focus border.
- Compact home list with one line per agent or space; more desktop shortcuts and a collapsible
  agent sidebar.
- Replies to several agent questions or selected passages in one message, with optional quote
  tokens in the composer.
- Run or copy shell commands from an agent's reply, with confirmation before running them.
- File attachments for supported document and code formats, alongside photos.
- Zoom and pan in the conversation image viewer; clickable links and Nerd Font icons in terminals.
- Codex update and weekly-limit notices, including an update path through the agent's terminal.
- Published multi-architecture Docker images and an in-app notice when a new wherdr release is
  available.
- Passkey maximum unlock age and **Lock all devices**; per-machine thread limits for
  herdr-projects.

### Changed

- Sent messages appear in the conversation immediately, with clear queued, sending and failed
  states; queued messages retain their attachments and send in order.
- Project cards and task lists better reflect coordinator tabs, thread queues and review status.
- Context menus open as bottom sheets on touch screens; phone sheets and desktop pane controls
  are easier to use.
- Terminal selection uses on-screen xterm selection again; wrapped lines copy without added
  line breaks.
- The passkey session's 12-hour timeout now measures inactivity instead of time since unlock.

### Fixed

- Claude Code sends no longer merge with text from another writer, and messages wait while an
  interactive menu occupies the agent's input.
- omp startup messages, shell command bubbles and Stop behavior; queued first messages and
  photos can be recovered when cancelled.
- Direct links to tabs, remote conversation reads, and pane state during server reconnection.
- Permission and question cards in short panes, plus keyboard handling for interactive cards.
- iPhone sheet placement, terminal and console overflow, and image and file display edge cases.

### Security

- Reject API calls initiated from another site and reject unknown or SVG conversation images.
- Leak checks can scan every commit in a range; test fixtures no longer use captured machine names.

## [1.1.0] — 2026-09-28

### Added

- Reorder machines, identify the local machine and keep a remote machine awake.
- Silence notifications per device; show a **Blocked** list in the project board.
- Create herdr-projects projects from wherdr with a clearer setup flow.

### Changed

- Show Herdr space names on cards and the full installed version in the header.
- Improve project action input, backlog handoff and worktree close confirmation.

### Fixed

- Correct Claude Code effort changes and their displayed value.
- Keep desktop composer controls clear of terminals and hide internal project markers.
- Make leak checks work from a Git worktree.

## [1.0.0] — 2026-09-27

First public release.

### Added

- Live agent list with answer previews and one-tap replies to permissions and questions.
- Claude Code and Codex conversations with Markdown, tool calls, images and search; live terminal
  view with mobile keys; composer with queued messages, photos and slash commands.
- Per-session model and effort controls; new agents, folder browser, Git worktrees, changes view
  and global search.
- Multiple machines and Herdr sessions, herdr-projects grouping, and Claude and Codex quotas.
- Web Push notifications, offline reading, passkey lock, themes, and English and French layouts
  for desktop and phone.
