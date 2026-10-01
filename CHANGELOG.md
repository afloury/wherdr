# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

First public release.

### Added

- Live agent list grouped by state, with answer previews and one-tap answers to permission
  prompts and questions (including omp's ask questions, shown in full even when the terminal
  folds them, multi-select and the final Submit).
  Ready agents can be sorted by Herdr order (drag to reorder), recent activity or name.
- Conversation view for Claude Code, Codex and omp transcripts (Markdown, tool calls, images,
  search, infinite scroll), typing effect with optional encrypted-text reveal. For omp it also
  shows the notes the terminal shows (advisor, finished background jobs, agent messages), and
  omp's status line (model, folder, branch, context and quota meters) under the composer.
- omp slash commands in the composer: built-in commands, file commands and `/skill:<name>`
  suggestions; file commands show as `/name args` in the conversation.
- Collapsible agent sidebar on a computer: a narrow rail with search, new agent, settings and
  state counters, remembered per device.
- Terminal view (xterm.js, WebGL or DOM renderer) with a phone key bar and take-over.
- Composer with queued messages (cancellable), photos, paste, slash commands and their output.
  A message sent to an agent Herdr hasn't finished starting waits and goes out once it's ready.
- Per-session model and effort pickers for Claude Code and Codex.
- New agent: installed agents or terminal, folder browser, Git worktree and branch, resume the
  last conversation, queued first message.
- Git changes view and worktree management; global search.
- herdr-projects grouping (coordinator and threads).
- Several machines through the SSH machines registered in Herdr; named Herdr sessions.
- Claude and Codex quotas on the home screen, with an invisible Claude Code status line.
- Web Push notifications, including `herdr notification show`; Herdr plugin actions.
- Offline reading of the last known state and recent conversations.
- Passkey lock (WebAuthn).
- herdr.dev and Herdr themes, English and French interface, phone and desktop layouts.
