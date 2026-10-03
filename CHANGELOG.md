# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

First public release.

### Added

- herdr-projects: max threads per machine, across all projects (Settings → Plugins →
  herdr-projects; empty = no global limit, saved on the server). wherdr counts the open threads of
  every project on each machine, shows `2 of 2 thread slots in use on <machine> (all projects)` in
  the In queue header, and writes `.wherdr-limits.json` (`{ this, machines: { <machine>: { max,
  open, free, threads } } }`) in each herdr-projects folder where a coordinator runs. The
  coordinator rules now say to check it before starting a thread and to wait while the machine is
  full, with `herdr-projects overview` as the fallback.
- Terminal: clickable links. OSC 8 hyperlinks (such as a login screen's "Open login URL") and
  plain `http(s)://` URLs open in a new tab, without opener, with `⌘`+click on a Mac or
  `Ctrl`+click elsewhere (a plain click still starts a selection; hovering shows the URL), or a
  tap on a touch screen; only http and https are opened. A URL wrapped over several rows is one
  link. Also in the side-by-side mirrors.
- Terminal: copying a line wrapped by the terminal width (a long URL, for instance) gives it back
  in one piece, without a line break between its rows; real line breaks stay. Herdr paints each
  row on its own and TUIs often wrap long lines themselves, so a row filled up to the last column
  and followed by a row that starts with a character (box-drawing borders excluded) counts as
  wrapped.
- Messages to Claude Code are no longer glued to another program's (e.g. a herdr-projects
  `[hp inbox]` notice sent at the same moment). wherdr types the message itself and checks
  Claude's input field on screen: it waits until the field has stayed empty for a moment, and
  presses Enter only when the field holds exactly its text. Another writer's text that slips in
  is separated: the field is cleared, the message typed again, and the other text typed back
  as its own message right after (logged). A draft already in the field is never cleared: the
  message waits ("will be sent when the agent's input is free"), then shows **Not sent — the
  agent's input contains text** with Retry / Cancel after 2 minutes. A message that can't be
  confirmed as taken is shown as not sent, never dropped. wherdr's own sends to a pane go one
  at a time.
- Codex conversation: **Update** now also works when wherdr cannot run the update itself (in
  Docker, whose home is read-only): it is typed into the agent's own terminal. Codex exits
  (`/exit`), the pane's shell runs the known official command followed by an end marker with
  its exit status, then Codex restarts on the same conversation (`codex resume <id>`, through
  Herdr's `agent.start`, so Herdr keeps tracking it). The line above the composer follows each
  step (Exiting Codex… / Updating Codex in its terminal… / Restarting Codex…). The button waits
  while Codex works or waits for an answer; a Codex menu on screen or a Codex not started from a
  shell are refused before anything is typed. On failure the pane stays at its shell with the
  exit code, the last line printed and **Copy command**. Over SSH, or with a writable home, the
  update still runs directly without stopping the agents, then **Restart to update**.
- `/resume` card: `Ctrl+A` on the computer keyboard switches between every project and the
  current one, like the card's button (also with the empty message field focused). `⌘A` keeps
  "select all" on macOS; a field with text keeps its own `Ctrl+A`.
- Codex conversation: when a newer Codex is out, a line above the composer says so ("Codex
  0.160.0 available (you have 0.159.1)") with the release notes and an **Update** button. After
  a confirmation that shows the command, it runs Codex's own official update command on the
  agent's machine (over SSH, or locally when `~/.codex` is writable) — only a known command
  (standalone installer from `chatgpt.com/codex/install.sh`, npm, bun, Homebrew), never text
  read from the screen; otherwise the command is offered to copy. Once installed, **Restart to
  update** restarts the agent on the same conversation (`codex resume`). The latest and
  installed versions come from Codex's files (`~/.codex/version.json`, the standalone package);
  the running one from the TUI's own header on screen, the conversation's `cli_version` (written
  by Codex's shared background server, maybe another version) only without it. When 25 % or
  less of the weekly limit is left, a warning line shows what is left and when it resets, with a
  `/status` button; it uses the freshest reading (any conversation of the machine, or `/status`
  on screen after an early reset) and disappears once the window has reset.
- Attach files, not only photos: drop, paste or pick (+ › File) the files the agent can read.
  Claude Code gets PDFs, Jupyter notebooks and text or code of any extension (text goes as
  `@<path>`, so its content is in the conversation without a permission prompt); Codex and
  other agents get notebooks, text and code. Archives, videos, audio, Office documents and
  binaries are refused with the reason. Files are stored on the agent's machine
  (`~/.cache/herdr-web/files`, local or over SSH, mode 600, safe names, deleted after 7 days;
  10 MB for text, 20 MB for notebooks, 30 MB for PDFs). The composer and the sent message show
  a file chip; in a sent message it opens the path menu (Reveal in Finder, Open, Copy path).
- Live agent list grouped by state, with answer previews and one-tap answers to permission
  prompts and questions (including omp's ask questions, shown in full even when the terminal
  folds them, multi-select and the final Submit).
  Claude Code's AskUserQuestion is a card too, completed from the transcript when a short pane
  shows only part of it: checkboxes (ticks kept for the options scrolled out of view),
  "Type something" typed in place, Submit and the review step. A numbered list in the agent's
  previous reply, still on screen above the box in a tall pane, no longer hides the card.
  In the conversation view, omp's "Other (type your own)" opens a text field under the
  question (multi-line, replaces an earlier custom answer); a reply typed in the composer
  while omp asks is sent as that custom answer. A multi-question omp ask shows its question
  tabs (and Submit) above the question, to go back and change an answer (←/→ on a computer).
  Ready agents can be sorted by Herdr order (drag to reorder), recent activity or name.
- Conversation view for Claude Code, Codex and omp transcripts (Markdown, tool calls, images,
  search, infinite scroll), typing effect with optional encrypted-text reveal. For omp it also
  shows the notes the terminal shows (advisor, finished background jobs, agent messages), and
  omp's status line (model, folder, branch, context and quota meters) under the composer.
- Default pane view on a computer (Settings › Desktop): a pane without an explicit choice opens
  on the Conversation or on the Terminal, as chosen; the phone always opens the conversation.
  An explicit switch (selector, Ctrl+`, phone icons) is remembered per pane, switching back to
  the Conversation included; changing the default applies at once to the panes without one.
- omp slash commands in the composer: built-in commands, file commands and `/skill:<name>`
  suggestions; file commands show as `/name args` in the conversation.
- Collapsible agent sidebar on a computer: a narrow rail with search, new agent, settings and
  state counters, remembered per device.
- Keyboard shortcuts on a computer: previous / next agent (`Alt+↑/↓`), new space, new tab and
  close pane (`Mod+Alt+N/T/W`, also from the terminal), open the agent folder in the editor
  (`Mod+Alt+O`), conversation search (`Mod+F`),
  conversation / terminal (``Ctrl+` ``), stop a working agent (`Esc`, empty field), settings
  (`Mod+,`) and a shortcut list (`Mod+/` or `?`, Settings › Computer). Tooltips and menus show
  the keys. The "Your turn" card's digits also work on AZERTY without Shift, outside the message field.
- The agent's current folder in its default editor on the agent's Mac: Mod+Alt+O, also in the
  agent menu ("Open in editor"). Same safeguarded action as a folder path in a conversation
  (Reveal in Finder / Open); the folder is never opened as an app or script. In Docker on a
  Mac, an optional SSH route to the host (`scripts/install-host-open.sh`) enables it too.
- First bound the folder shortcut to Mod+Alt+E; moved to O the same day — Firefox and Zen own
  ⌘⌥E (Network Monitor) on macOS, Zen also uses Ctrl+Alt+E for workspaces.
- Terminal view (xterm.js, WebGL or DOM renderer) with a phone key bar and take-over.
  Shift+Enter inserts a newline in agents, as in a native terminal.
- Composer with queued messages (cancellable), photos, paste, slash commands and their output.
  A queued message looks like the sent one (photos above the text bubble), photos sent without
  text included, and keeps its photos until it lands, even across a server restart.
  A message sent to an agent that is still starting waits and goes out as soon as it's ready,
  including an omp agent already waiting at its prompt that Herdr still counts as starting.
- Per-session model and effort pickers for Claude Code, Codex and omp. omp uses its own
  "Switch Model" selector (`/switch`, `/model` or alt+p), read and driven on screen: the
  picker lists the models omp offers, Enter applies for the session only (never the
  default), and the conversation shows the switch as a "/model → …" line.
- New agent: installed agents or terminal, folder browser, Git worktree and branch, resume the
  last conversation, queued first message. The last 30 folders used on each machine are kept:
  6 show as chips, `+N` shows the rest, and a field filters them by name (Enter takes the
  first match). The folder browser filters long subfolder lists by name the same way.
- File and folder paths in agent replies (`~/project/app.ts`, `src/app.ts:42`) are clickable:
  Reveal in Finder and Open on the agent's Mac (local or over SSH), Copy path everywhere. Only
  existing paths under the machine's home; apps and scripts are never opened.
- Git changes view and worktree management; global search.
- herdr-projects grouping (coordinator and threads).
- Several machines through the SSH machines registered in Herdr; named Herdr sessions.
- Claude and Codex quotas on the home screen, with an invisible Claude Code status line.
- Web Push notifications, including `herdr notification show`; Herdr plugin actions.
- Offline reading of the last known state and recent conversations.
- Passkey lock (WebAuthn).
- herdr.dev and Herdr themes, English and French interface, phone and desktop layouts.
- Context menus (long press, right click, "…" buttons) on cards, headers, tabs and paths open
  at the pointer with a mouse on a computer, and as the bottom sheet on phones, tablets and
  narrow windows; long press then move still drags a card.
- Project panel: new optional **In queue** (launched automatically by the coordinator as soon as
  a thread slot frees, with the slots in use) and **To do** (prioritized, never auto-launched)
  lists with Move up / down, Queue it, Launch now and Back to backlog / Remove from queue; lists
  always show in a fixed order, and the coordinator rules describe each list.

### Removed

- Terminal drag-select auto-scroll (dragging near or past the top or bottom edge made Herdr
  scroll and extended the selection through the history), with its early clipboard write and
  the "Selection ready" toast. Selection in the computer terminal and the mirrors is xterm's own
  again: only the text on screen, no scrolling when the pointer leaves the terminal. Releasing
  the button copies it (one clipboard attempt, nothing shown if the browser refuses), and
  `⌘C` / `Ctrl+Shift+C` copy it too.
