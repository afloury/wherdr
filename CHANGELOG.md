# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Settings › Conversation › Quoted replies is now a choice of how the field shows the quotes, per
  device (computer and phone): "“>” lines" (plain text, default), "Tokens, native field" (the
  plain field, its quote lines drawn as tokens: typing, dictation and autocorrect unchanged) or
  "Tokens, rich field"; both token options are marked experimental. The preview shows the chosen
  option; a former switch turned on keeps the rich field.
- Chat: images an agent's tool returned (omp `read` of a PNG, a screenshot, Claude `Read`,
  Codex `view_image`) show as thumbnails under the action, even when the action block is
  folded, and open in the image viewer.
- Settings › Appearance › Desktop (computer only): Background "wherdr grid" (default) shows the
  website's dotted grid with light packets in the margins of the conversation; "herdr grid" keeps
  the flat line grid. Content width moved here from Settings › Desktop. Phones show no grid.
- Component tests (Vue components mounted in a Nuxt environment) and end-to-end tests in
  Chromium and WebKit, at iPhone and desktop sizes, against a fake Herdr server.
- GitHub Actions CI on pushes and pull requests to `main`: unit, component and end-to-end tests,
  type check and leak check.

### Changed

- Quoted replies as tokens in the field are marked experimental and are now off by default on a
  computer too (Settings › Conversation › Quoted replies).

### Fixed

- The model and effort under the input field no longer turn into a bare "Model" when reading the
  transcript briefly fails (SSH machine connection dropped, timeout): the last known value stays.
- An omp `!` or `$` command sent while omp is working no longer stays "Queued · sending…" (then
  "Not sent", inviting a second run): omp runs it at once but records it only when the next prompt
  starts, so its bubble now goes when that turn ends; the "You ran" block shows once omp records it.
- Pasting an image (`⌘V` on a Mac) into a terminal, full view or side by side, now reaches the
  agent: it is uploaded to the agent's machine and its path pasted through Herdr, which omp and
  Claude Code attach as an image. Before, the terminal only pasted text and the image was lost.

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
