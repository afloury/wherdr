# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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

- Quoted replies as tokens in the field are marked experimental and are now off by default on a
  computer too (Settings › Conversation › Quoted replies).

### Fixed

- Herdr plugin, native mode (macOS): Start failed when Herdr's server `PATH` did not contain
  node (n, nvm, fnm, Volta…) yet said “started”. The install now saves the absolute path of node
  in `~/wherdr/plugin.env` (`WHERDR_RUNTIME`), Start looks in the usual folders when it is gone,
  and reports success only once the port answers, with the end of the log otherwise.
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
