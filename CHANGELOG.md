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
  In the conversation view, omp's "Other (type your own)" opens a text field under the
  question (multi-line, replaces an earlier custom answer); a reply typed in the composer
  while omp asks is sent as that custom answer. A multi-question omp ask shows its question
  tabs (and Submit) above the question, to go back and change an answer (←/→ on a computer).
  Ready agents can be sorted by Herdr order (drag to reorder), recent activity or name.
- Conversation view for Claude Code, Codex and omp transcripts (Markdown, tool calls, images,
  search, infinite scroll), typing effect with optional encrypted-text reveal. For omp it also
  shows the notes the terminal shows (advisor, finished background jobs, agent messages), and
  omp's status line (model, folder, branch, context and quota meters) under the composer.
- omp slash commands in the composer: built-in commands, file commands and `/skill:<name>`
  suggestions; file commands show as `/name args` in the conversation.
- Collapsible agent sidebar on a computer: a narrow rail with search, new agent, settings and
  state counters, remembered per device.
- Keyboard shortcuts on a computer: previous / next agent (`Alt+↑/↓`), new space, new tab and
  close pane (`Mod+Alt+N/T/W`, also from the terminal), conversation search (`Mod+F`),
  conversation / terminal (``Ctrl+` ``), stop a working agent (`Esc`, empty field), settings
  (`Mod+,`) and a shortcut list (`Mod+/` or `?`, Settings › Computer). Tooltips and menus show
  the keys. The "Your turn" card's digits also work on AZERTY without Shift, outside the message field.
- Terminal view (xterm.js, WebGL or DOM renderer) with a phone key bar and take-over.
  Shift+Enter inserts a newline in agents, as in a native terminal.
- Composer with queued messages (cancellable), photos, paste, slash commands and their output.
  A message sent to an agent that is still starting waits and goes out as soon as it's ready,
  including an omp agent already waiting at its prompt that Herdr still counts as starting.
- Per-session model and effort pickers for Claude Code and Codex.
- New agent: installed agents or terminal, folder browser, Git worktree and branch, resume the
  last conversation, queued first message. The last 30 folders used on each machine are kept:
  6 show as chips, `+N` shows the rest, and a field filters them by name (Enter takes the
  first match). The folder browser filters long subfolder lists by name the same way.
- Git changes view and worktree management; global search.
- herdr-projects grouping (coordinator and threads).
- Several machines through the SSH machines registered in Herdr; named Herdr sessions.
- Claude and Codex quotas on the home screen, with an invisible Claude Code status line.
- Web Push notifications, including `herdr notification show`; Herdr plugin actions.
- Offline reading of the last known state and recent conversations.
- Passkey lock (WebAuthn).
- herdr.dev and Herdr themes, English and French interface, phone and desktop layouts.
