# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

- **Private by default**: wherdr now answers only this computer and your tailnet. Every request and WebSocket is judged on the address its connection comes from, which a client cannot forge: loopback; a tailnet address only when Tailscale, running on this machine, lists it as a peer (read from Tailscale every 10 s, never guessed from an interface in `100.64.0.0/10`); in Docker, the container's gateway only while wherdr's port does not also answer on it (a port published on every interface lets Docker's proxy hide outside clients behind the gateway; wherdr then logs a warning and serves the gateway only with a passkey lock). Proxy headers from a local proxy (`tailscale serve`) can only refuse more. While Tailscale Funnel exposes wherdr's port (HTTPS, TCP or TLS-terminated TCP), connections from this computer are served only with a passkey lock. A relay you run yourself on the machine still counts as this computer: the README and Settings › Security say so and recommend the passkey. A device on another network gets a page saying why (HTTP 403, `network`). Without Docker, wherdr refuses to start on an address other than loopback or this machine's tailnet address as Tailscale reports it (`HOST=0.0.0.0`, a LAN address). `WHERDR_TRUSTED_NETWORKS` names other private networks (ZeroTier, WireGuard: `10.147.17.0/24`); `any` accepts every network, with a warning at startup, a banner in the app that cannot be hidden and a setup guide that asks for the passkey.
- Funnel detection fails closed on the target too: any Funnel route counts unless its target clearly leads to another port (`0.0.0.0:7683`, other spellings of loopback, unparsable targets count; in Docker, every Funnel route). Tailscale is read again before every WebSocket upgrade and at most 2 s before an HTTP request, and open WebSockets are closed (1008) when a new reading no longer allows them.
- Network provenance fails closed: connections from this computer stay trusted only while Tailscale's latest reading proves that Funnel does not expose wherdr (a failed, garbled, missing or stale reading counts as exposed), and Docker's gateway only with `WHERDR_DOCKER_LOOPBACK_ONLY=1` (now in the shipped `docker-compose.yml`, next to its loopback `ports` line) and a port that does not answer on the gateway. Otherwise, without a passkey, the app shows **A passkey is needed here** and only the first-passkey routes answer (bootstrap token from the server logs). **Docker update:** a `docker-compose.yml` written by an earlier version lacks `WHERDR_DOCKER_LOOPBACK_ONLY=1`; add it (with the port still on `127.0.0.1`) or set up a passkey.
- The passkey lock is now optional: Settings › Security, the setup guide and Settings › Phone say so, and Settings › Phone works from the tailnet without a passkey.
- The **Update** button of the new-version banner shows on every device that can open wherdr, not only on `localhost` or after a passkey unlock (Docker still shows its command).
- Inline code in Project panel and Board tasks: text between backticks in `TASKS.md` (`` `npm test` ``) now looks as in a conversation, with the same tints (❯ command, ▸ path, # ID…), in light and dark themes; badges and links written inside code stay code. A tap or click on it (Enter or Space from the keyboard) opens a menu: **Copy**, and, when the code reads as a shell command and the coordinator can run one, **Run…**, which, as in the conversation, shows the command in full for confirmation, naming the agent, its pane, machine and folder, then runs it in the coordinator's shell mode (`! cmd`). The pane is checked again once confirmed: if its agent, session, folder or machine changed, it went offline or a question appeared, nothing is sent (the conversation's Run buttons get the same checks). The code is kept byte for byte when the task line is cleaned up (badges, old `[t-NNNN]` references, spaces, blocked cause). Dropdown at the code on a computer, sheet on the phone. Run is not offered offline, on a shell pane, nor sent while the coordinator waits on a question.
- iPad layout: in portrait (iPad mini 744 × 1133, iPad Air 820 × 1180) the app now uses the computer layout instead of a stretched phone view. The agent list stays a narrow column and slides over the conversation when opened (closed by a tap outside, Escape, or picking an agent); on the home page it opens by itself. Landscape keeps the docked sidebar. On touch tablets buttons are 44 px. Once a hardware keyboard is proven (an arrow, Escape, Tab or a ⌘/Ctrl/Alt chord), Enter sends the message (Shift+Enter adds a line); the proof is forgotten on any touch and when the message field loses focus; otherwise, including with the floating on-screen keyboard, Enter adds a line. Phones are unchanged, including large ones in landscape (932 × 430).
- Move tasks from the Project panel: each unfinished task's “…” menu moves it up or down in its list, to To do or to In queue, written straight to `TASKS.md` on the coordinator's machine (local or SSH). Only the task's line and its indented detail lines move; the rest of the file stays byte for byte. The write is refused when the file changed since the panel read it, and the list is re-read: the content hash is checked under a lock (one wherdr write at a time per file, across processes and machines), right before an atomic rename. A lock left by an interrupted write is never removed automatically: the move is refused and says which folder to remove. Up / Down and Queue / Remove from queue no longer go through a message to the coordinator.

## [1.3.4] — 2026-10-18

- Fix **Install herdr-projects** installing a version wherdr cannot read: upstream herdr-projects is now a 1.x that is a different product (a task board, with no projects, `TASKS.md` or threads) and whose first run moves `~/.herdr-projects` to `~/.herdr-projects-legacy`. The button and the copied command now install the 0.2 line from the fork (`herdr plugin install afloury/herdr-projects --ref v0.2.36 --yes`); installing from upstream, even pinned to v0.2.35, is not safe, because the plugin's own `herdr-projects update` would then offer 1.x. Installation is pinned to v0.2.36, which provides prebuilt binaries for macOS and Linux on ARM64 and x86_64; wherdr allows two minutes for the checkout and download. Settings › Plugins › herdr-projects now says when a machine has 1.x (“Not supported”, with the command to go back to 0.2, the warning not to run 1.x over 0.2 projects and a link to upstream's guide), and warns when a 0.2 installed from upstream would update itself to 1.x. Project actions on a machine with 1.x say it is not supported instead of “Projects binary not found”. README, the agent install guide on wherdr.dev and the wherdr skill point to the fork and say 1.x is not supported yet.
- Render plain bullet tasks with the same full-width text and badge footer as other project tasks. Every unfinished task, including custom lists and In progress entries, offers a question draft to the coordinator.
- Render PDF previews with a bundled, lazily loaded PDF.js worker on every device, including iPhone and iPad: all pages fit the window, with Retina canvases rendered near the viewport and released off screen. Open and Download keep their existing URLs.

- Fix missing Codex conversations and messages reported as “Not sent” on remote Linux machines using dash when a recent session day has no folder. Remote folder and file reads now identify missing paths independently of shell error wording, including byte-range reads.
- Say why a conversation is missing when Herdr's integration of the agent is not installed: instead of “No conversation for this agent yet.”, the conversation of an agent already at work (or running before wherdr started) explains that wherdr cannot find it without the integration, shows the exact command (`herdr integration install codex`, `claude` or `omp`) to run on the agent's machine, then restart the agent, with Copy command and View terminal. wherdr reads `herdr integration status` on that machine (cached for a minute) only when a conversation is not found; a brand-new agent that has not been asked anything still shows “No conversation for this agent yet.”
- Fix project skills and commands missing from the “/” menu of a Claude Code conversation when the agent runs in a subfolder: like Claude Code, wherdr now reads the `.claude/skills` and `.claude/commands` of the pane's folder and of each parent folder, up to the Git root and never past the home folder. When macOS refuses to list those folders (a project under Documents, Desktop… on a Mac reached over SSH without full disk access), the menu now says so, with the setting to turn on, instead of silently showing no project commands; typed in full they still work. A skill or command added on the machine shows up in the menu within about 20 seconds, without reloading the app.
- Fix Codex being interrupted by scrolling its terminal: Codex tracks the mouse, so each scroll becomes a wheel report written to its terminal. A trackpad flick sent about 60 of them a second; when Codex read them late, the tty buffer filled up (about 1 KB on macOS) and a read could end right after the Escape that starts a report. Codex took it for the Escape key, interrupted its turn and typed the rest (`[<65;76;23M`) into its field. Scrolls are now merged and sent at most every 75 ms (a two-second flick: 270 bytes instead of 1,200).
- Show a Codex turn stopped by Escape as “Interrupted” in the conversation, as for Claude, and show text left in Codex's input field above the message field (it would otherwise be sent glued before the next message), with a button to clear it.

- Fix “No subfolders” shown for a folder that macOS refuses to list (Documents, Desktop, Downloads… over SSH without full disk access): the folder browser now says “macOS blocks access to this folder” with the setting to turn on (Remote Login › “Allow full disk access for remote users” on a remote Mac, Full Disk Access on this Mac), or “Permission denied” for plain Unix rights. Parent and the path field stay usable. The Files window reports the same refusal instead of an empty folder.

- Preview PDFs in the Files window and from a file named in a conversation, on this computer or a remote machine, with PDF.js (up to 50 MB, like Download). **Open** shows the same PDF in a new tab, where an iPhone uses its native viewer with every page. The PDF is served as `application/pdf` with `nosniff`, framed by the app only, and runs nothing in wherdr's origin; other binary files still show “Binary file”, and Download is unchanged.
- Passkey lock: the duration chosen in Settings → Security is now the only rule. The passkey is asked again at the first opening after the last unlock plus that duration, used or not in between; the 12-hour idle lock is gone. Open sessions move to the new rule without a new unlock, and a changed duration applies to them right away (a session in use is not cut on the spot).
- Release unmounted conversations while keeping per-agent drafts, attachments, pasted text and prompt-history draft restoration persistent.

- Fix a message ending with a backslash never reaching Claude Code: Claude reads “\\” then Enter as a line break, so the message stayed in its input field while wherdr showed it as sending. Such a message is now typed with a trailing space that Claude drops, and submitted with its backslashes intact; a send that leaves part of the message in the field is reported as not sent.

- Fix Claude Config tab clicks using the real focus legend, verify each tab transition, and report failed switches.
- Lighten an open tab: the interactive-terminal window is driven by state changes and one timeout at the end of its debounce instead of a 100 ms poll; the Markdown and question caches are capped in characters, least recently used first, and drop the earlier versions of a reply still being written; the Claude and omp spinners stop while the page is hidden and resume on the right frame and elapsed time.

- Recall previous messages and slash commands with ↑/↓ in the message field, with per-agent history and draft restoration.

- Make native menu arrows responsive, focus Claude settings tabs before switching, show the live Codex usage terminal with its subtitle, and dismiss stale command previews when native controls appear.

- Refresh consecutive agent questions faster and refuse outdated card answers, including keyboard confirmation, typed replies and menu clicks. Identify full questions before display truncation. Re-read viewed cards independently of slow batches with reserved RPC capacity; keep newer captures when an older batch completes. Menu clicks identify the target and its details across scrolling. Publish a viewed pane as soon as its read completes; keep native forms disabled with an explanation during read failures and bound screen-read concurrency.
- Native-answer validation and input are separate Herdr RPCs: Herdr protocol 22 has no conditional send. A question can still change between the checked read and key injection, or recur identically; this race is not closed by wherdr.

- Use “Done” consistently for completed project threads and “Mark done” for their action, sharing the Board’s status labels.
- Fix npm release archive paths and allow manual publication of an existing release from `main`.
### Added

- **Board project filter**: the filter button in the Board header hides chosen projects, or the
  agents outside projects (**Other agents**). The choice is kept on the device; column counts
  follow the filter, and a new project shows until you hide it.

## [1.3.3] — 2026-10-12

### Added

- **Live terminal window for interactive agent screens**: ambiguous menus and panels open
  the real pane in a modal window, with a key bar and an always-visible Close button.
  The scrim of the other windows covers the whole app and keeps clicks and focus in the
  terminal; a click on it closes the window, Escape goes to the agent. In a split, only the
  cell in use opens it.
  A stable return to the message field closes it; manual dismissal lasts for that interaction.
  The window fits the pane to its container and releases its existing size lease when closed.
  Existing native questions, approvals, menus, waiting screens and Claude settings cards
  retain their controls, compact-card previews, one-tap answers and notifications.
  The window is a fallback after their recognizers, with explicit exceptions for
  Codex's two-column `/usage` and Agent Command Center.
  Codex `/usage` is no longer copied into a static result and a guessed two-column choice list.
  The browser demo includes a scripted version of the interactive usage screen.

- **Project panel › Settings and Memory tabs**, both read-only. **Settings** shows what
  PROJECT.md sets (name, goal, coordinator and thread profiles, parallel threads, auto-resolve
  delay, nudge, mute, repositories), with the plugin's default marked for a key the file leaves
  out; safety settings are not shown. **Memory** lists MEMORY.md and the files of `memory/` with
  the title and hook the index gives them, and opens one as Markdown. With six tabs the bar
  scrolls sideways on a phone; a fade on its edge says there are more.
- **Project panel › Inbox and Routines tabs**. **Inbox** lists the project's unhandled inbox
  items (a thread's new report, a routine due, a machine out of reach…), oldest first, with the
  thread's title when the item is about one; **Done** marks one as handled (`herdr-projects
  inbox done`). **Routines** shows each routine's schedule, whether it is enabled, its kind and
  its last and next run, read-only: approving or switching a routine stays in the terminal.
  herdr-projects has no JSON for either yet, so the inbox is read from the project's `inbox/`
  files and routines from the tab-separated output of `routine list`, whose run texts are shown
  as printed.
- **Project panel › Threads tab**: every thread of a herdr-projects project, as `herdr-projects
  thread list` gives it. Open threads sit under their group (Your turn, Ready for review,
  Working…) with machine and profile; resolved ones stay in their own folded section, by pages of
  30. One filter covers both (ID, title, machine, profile). A tap opens the thread's record
  (`thread show`): state, Next list, branch, dates, and its actions, run by herdr-projects on
  the coordinator's machine: **Acknowledge**, **Restart**, **Stop** and **Resolve** (the last two
  ask first), plus Open agent, View report and Pull request. The panel now has tabs (Tasks,
  Threads). Nothing changes without herdr-projects.
- **Diff review on a line or a block of lines**: in Changes, comments start from the gutter and
  the code is plain text that can be selected and copied — a click on a line no longer creates a
  comment. With a mouse, a **+** shows on the hovered line: click it, or press and drag over
  other lines for a block (Shift+click changes the block of the open editor). On a phone, tap a
  line number, tap another line to extend, then **Comment** in the bar pinned at the bottom. On a
  keyboard, arrows move between lines, Shift+arrows choose a block and Enter opens the editor;
  ⌘/Ctrl+Enter saves, Escape cancels without closing the window. A block stays within one hunk.
  Each comment is a thread under the last line of its block, with its lines ("Lines 12–18"),
  Edit and a two-step Delete; drafts, including an editor left open, are kept per agent on the
  device, and a block that leaves the diff or whose code changed is flagged after refresh. Send review appends
  `file:12-18 — remark` and a short excerpt of the block, grouped by file, to the message draft
  without sending it or replacing existing text. Old-line labels for deletions, remote agents
  and demo support.
- Publish checksummed GitHub release packages independently of npm moderation. Native
  plugin installs and one-tap updates verify these packages, including the agent skill;
  Homebrew uses the same GitHub archive. npm publishes that exact archive separately.
  Registry and formula availability gate update notices; the legacy GitHub latest marker
  advances automatically only when existing 1.3.x updaters can safely install the version.
  Plugin installs fall back to the prebuilt npm archive before compiling. Preserve validated
  update notices on transient failures; require a prepared draft with notes before publishing.
  Release readiness reports missing npm/Homebrew conditions and leaves an unchanged latest alone.

- Bundle the wherdr agent skill in npm / Homebrew packages and Docker images. Native
  starts and one-tap updates refresh the shared host copy; the Herdr Docker plugin
  extracts it after pulling the image. Manual Docker installs have a host-side helper.
  Existing unrelated skills are preserved, and missing agents or write failures do not
  prevent startup. Document plain task URL links in the skill.

- **Board**: one view of everything, in four columns (Blocked, Todo, Ongoing, Finished): every
  agent pane, also outside projects, and with herdr-projects every project, thread and
  `TASKS.md` task, read for all projects at once (`GET /api/board`). Opened with `H` or the
  board button above the agent list; each card opens its Project panel, thread, report or
  agent. Moving a task card (drag and drop on a computer, **Move to…** everywhere) sends the
  coordinator the Project panel's message, or the new `↳ Mark blocked`, `↳ Move to To do` and
  `↳ Mark done` (coordinator rules and `skills/wherdr/SKILL.md` updated). Thread and agent cards
  follow their state. English and French, phone and computer, demo included.
- **Inline diff review**: comment on lines in Changes, edit or delete remarks, and keep a
  device-local draft per agent. Missing lines are flagged after refresh. Send review appends
  grouped file/line remarks to the message draft without sending it or replacing existing text.
  Includes old-line labels for deletions, keyboard/touch controls, remote agents and demo support.
- **Yes / No in one tap**: a closed question of an agent's reply now has **Yes** and **No** next
  to its `↳ Reply`, in the three reply styles. A tap quotes the question and writes the answer
  under it, as Reply and typing would; nothing is sent, so several questions are answered in a row
  and the keyboard stays down on a phone. The other answer replaces the first, typed words are
  never replaced. Offered only when yes or no answers the question in full: a single sentence
  with a yes/no opening, no alternative, no interrogative word and no negation; otherwise Reply
  alone.
- **Decision tables answered row by row**: under a Markdown table of numbered questions (a
  number column, and a question column known by its header, by its question marks or by an advice
  column next to it), **OK to all** accepts the whole table, and each row has **Yes**, **No** and
  `↳`. Every answer names the message and the row it refers to
  (`↳ Quote decision 11:37 #3 : … —`, then `Yes`), so an answer to an earlier table is never read
  as an answer to the agent's last message. Composed in the field, sent by you; a table of another
  shape gets nothing.
- **N questions unanswered** above the field: the questions of the agent's last message, and the
  rows of its decision tables, that the draft does not answer yet. A tap scrolls to the first
  one. It goes once everything is quoted or answered and when the message is sent, never shows
  for earlier messages or while the agent works, and takes no room: nothing moves when it comes
  or goes. When the message asks one thing only, any typed words count as its answer.
- The demo's Claude agent now ends its reply with a closed question, to try the one-tap answers.
- **Restart after Codex updates itself**: when Codex's own installer exits to its shell,
  a Your turn card offers a one-tap restart and sends the usual attention notification.
  A new conversation reuses its launch command; an existing one can resume its exact session
  or start fresh. If the session is uncertain, Resume opens Codex's conversation picker.
  Restart checks the foreground process and the unchanged empty prompt before typing.
  Dismiss puts the card away and gives the pane back as a plain shell; the messages that waited
  for the restart go back into the message field.
- **Browse files** in an agent's ⋯ menu: a read-only browser of its project (the Git root, or the
  agent's folder outside Git), opened on the agent's folder. Folders and files with their sizes, a
  breadcrumb to go back up, text files with line numbers (first 256 kB), images up to 2 MB.
  Hidden files (name starting with a dot) are shown; **Show hidden files** hides them, remembered
  on the device. Local and remote machines alike; nothing above that root is shown, symlinks
  included, and nothing is written.
- **Preview** and **Download** on a file path in an agent's reply (and on a sent attachment),
  whatever machine the agent runs on: Preview shows the file in a window like Browse files, and
  Download saves it on the device you are using, where Copy path alone did not help when the
  agent runs on another machine. Browse files' preview gets a **Download** button too. Files in
  the home folder only, symlinks included, up to 50 MB.
- **Discuss a point**: a list item or a paragraph of an agent's reply that asks nothing can now be
  quoted in the field like a question, to answer it in the same message. Not offered on code,
  tables, quotes, titles, an introduction ending with a colon or a point of one or two words.
- **Settings › Conversation › Reply style**: three ways for a reply to offer its questions and
  points, saved on the device. **Icon** (default): a small `↳` after each question and a grey one
  after each point (on hover on a computer, always there and pale on a phone). **Tap the text**:
  no button, the underlined question is tapped; a point is clicked on a computer, and on a phone
  tapped once to show **↳ Discuss**, so that a tap while reading never quotes. **List under the
  message**: a number after each question, the questions listed under the message, and
  **+ Quote a point** to pick a point, offered only when there is a choice (a list item, or two
  points or more), not under a reply of plain prose. All of them work with the keyboard.

### Changed

- **One syntax for every reference: `↳ <type> <reference> : <excerpt> —`.** Replying to a
  message, quoting a question, a point or a passage, answering a row of a decision table and the
  Answer / Clarify / Comment actions of the Project panel all write the same kind of line, the
  answer on the lines below: `↳ Quote message 11:37 : I can merge the PR —`,
  `↳ Quote point 11:37 : … —`, `↳ Quote decision 11:37 #3 : … —`,
  `↳ Quote decisions 11:37 #1-4 : … —`, `↳ Decision: <task> —`. The reference ends with ` —` at the
  end of its line only (an excerpt may hold dashes), a long excerpt is cut with `…`, and several
  references fit in one message. A short code after the time or the row (`11:37 #3 ~k3f`) tells
  apart two messages of the same minute and two tables of one message, so an answer never
  replaces the answer to another table; the field draws it dimmed, the sent quote leaves it out.
  **OK to all** names the rows the table really has (`#1,4`, not `#1-4`, when rows 2 and 3 do
  not exist). The field draws each one as a token and the sent bubble as a
  quote that leads to the message it names. **Reply** under a message no longer opens a box above
  the field: it adds its line like the others. A `>` typed at the start of a line is plain text
  again; messages already sent with `> ` lines still show as quotes. Pasted text never becomes a
  reference: a pasted line that reads like one gets a `\` before its `↳`, and a **Pasted text**
  card is sent exactly as pasted. The Project panel drafts that started with `↳` now put the
  answer on the next line instead of after the dash, and **Problem** and **Question** write the
  same kind of line (`↳ Problem: <task> —`, `↳ Question: <task> —`) instead of `✗ Problem: … — `
  and `? Question: … — `; the `wherdr` skill and the coordinator rules explain the new lines.
- **Quoted replies: two choices.** Settings › Conversation › Quoted replies keeps "Tokens, native
  field" (default) and "Plain text", the same `↳ … —` lines shown as text, as a fallback. The
  experimental "Tokens, rich field" is removed; a device set to it moves to the native field.

- **↳ Reply looks the same wherever the question is**: the button of a question that ends a
  message was only shown on hover on a computer, while one in the middle of a paragraph stayed
  visible. Both now show the same way, and the labelled tag gives way to the icon (or to the
  style chosen in Settings).
- **Compact list by default**: the agent list (home screen on a phone, sidebar on a computer)
  now shows one line per agent or space unless you chose otherwise. A device where Settings ›
  Appearance › Home screen › Compact list was never touched switches to the compact list; a
  device where it was turned off keeps the detailed cards. Turn it off there to get the preview,
  folder and model back on the cards.
- **One-tap answers in the compact list**: the one-line card of an agent waiting for an answer
  opens on its question, the requested action and the same answer buttons as the detailed card,
  then folds back to one line once answered. The other cards stay one line.
- **Quoted replies: tokens in the native field by default.** Settings › Conversation › Quoted
  replies is one list for the device in use, instead of one for a computer and one for a phone.
  "Tokens, native field" is the default and no longer marked experimental. Every device moves to it once, whatever it had saved (a choice could not be told
  from the former default); a choice made afterwards is kept. The preview plays once instead of
  looping, and has a **Replay** button like the typewriter preview.

### Fixed

- Show Claude usage-limit waits above the conversation field with automatic resume, cancel,
  usage credits and reset actions when offered, without opening the interactive terminal.
- Disabled routines and resolved threads (their record in the Project panel, their card on the
  Board) use neutral gray badges; enabled routines stay green.
- A pane whose agent changed while its session stayed the same could show an empty
  conversation ("No messages yet.") until a new message arrived: its transcript was read as the
  other agent's. A transcript is now always read as the kind its file says.
- Preserve unchanged skill files and repair only recorded managed broken links. Respect
  `WHERDR_SKILL=off` and persistent uninstall across starts and updates. Docker extracts
  only skill data with the local helper and the one-command installer refreshes it too.
  Bound updater refreshes, preserve service paths, and report manual helper failures.
- **Back pressed while the app loads**: an address change that arrived during startup (Back
  right after a reload, a hash set as the page loads) was undone, and the app stayed on the view
  it started on. The last address asked for now wins.
- The manual Homebrew formula update uses the authenticated GitHub user's noreply
  identity in its temporary clone, including on machines without a Git email configured.

- **Project panel messages never answer the coordinator's screen**: a button pressed while a
  Claude or Codex coordinator waited on a question or a permission dialog typed its message there
  and pressed Enter, which could answer it. Panel and Board messages now always go through the
  message queue, held until the coordinator's input field is back, and are refused when the pane
  no longer runs an agent. One task message is sent at a time, app-wide.
- **TASKS.md lines are cleaned before use**: control characters, terminal escape sequences and
  invisible direction marks in a task line are removed, so a button never types them into the
  coordinator's terminal. Very long lines (over 2,000 characters) are ignored, and headings are
  read without a regular expression that could stall the server on long runs of spaces.
- **Tab threads open from the Project panel**: a thread opened as a tab of its coordinator has no
  pane name; it is now found by its herdr-projects token.
- **One diff line per row in Changes**: since inline review, every line of a diff was 44 px high
  (a blank line after each one) with the comment marker under its line number. A row is one line
  of code again, on a computer and on a phone; the marker shows beside the number on hover or
  keyboard focus.
- **Long folders scroll in Files**: a folder taller than the window (1500 files, for example) did
  not scroll with the wheel, the trackpad or a finger, so its last files were out of reach. Changes
  had the same defect, and its review bar now stays pinned while the diff scrolls.
- A confirmation asked from an open window (a sheet on the phone) showed behind it; it now
  sits above every window.
- **Pasted text cards on every device**: a message with typed words and a text pasted into the
  field showed its card only on the device that sent it; elsewhere it was one long folded message.
  The server now remembers which parts were pasted (`pastes.json` in its data folder, the last 100
  texts, each for 30 days), so every device shows the same card, for Claude, Codex and omp, queued messages
  included. Not covered: a paste typed into a Codex or omp terminal, and messages sent before
  this version.
- **Codex restart after an update**: Project panel messages wait instead of being typed
  into the stopped shell. Unfinished quotes and heredocs refuse a restart; uncertain
  transcripts offer both choices without reusing a contradicted session ID. A rapidly
  replaced Codex keeps its own launch arguments.
- **Terminals in split panes**: every visible terminal fills its cell and stays connected
  when focus changes. Moving focus routes keyboard input without replacing terminal instances.
  Divider resizing updates all terminals while dragging. Leaving the tab restores original
  sizes, respecting later resizing by a Herdr client. The browser demo follows the same sizing
  behaviour and places short Claude exchanges at the top without inserting blank rows.
- **Panes side by side on a computer**: with the default background (Settings › Appearance ›
  Desktop › Background "wherdr grid"), a conversation shown next to another pane had the dotted
  grid and the two lines of the reading column running through its messages and around its
  field. A pane in a split is back on a plain background, full width; the grid stays in the
  margins of a pane opened alone. Seen in the online demo, the same in the app.
- **Blocking prompt on the "wherdr grid" background**: the grid no longer shows behind the
  question and its choices; the reading column stays plain and framed there too.

## [1.3.2] — 2026-10-10

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
- **Project panel › Add info**: each working thread (its card under In progress, or the In
  progress task of a thread) has an **Add info** button. It opens a multi-line text field (a
  full-screen sheet on the phone); what you type is sent to the coordinator as
  `↳ Info for t-NNNN: …` (`↳ Info pour t-NNNN : …` in French), and the coordinator passes it on
  to that thread as is. The `wherdr` skill and "Copy rules for the coordinator" describe the new
  message.
- **wherdr.dev for search engines**: `sitemap.xml` generated at build time with the date of each
  page's last change, a `robots.txt` that names it, a canonical link, complete Open Graph and
  Twitter Card tags with a new 1200×630 share image, and `SoftwareApplication` structured data.
  The demo and the installer script stay out of search results.
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
- **Why wherdr**: a section at the top of the README and on wherdr.dev that says in six points
  what wherdr adds to Herdr.

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

### Fixed

- **↳ Reply on a question in the middle of a paragraph**: a question followed by other
  sentences ("Shall I start step 1 now? A slot is free.") now gets its **↳ Reply** button, placed
  right after the question; the quote added to the field is the question alone, not the
  paragraph. A paragraph or list item with several questions gets one button per question, in
  order (questions that follow each other stay one quote). Still no button for a "?" in code, in
  a URL, in quoted words (`You asked "can it be faster?"`), in a title or a table, nor for a
  question the agent answers itself ("Is it done? Yes.", "Why? Because…"). On a computer, a
  button in the middle of a paragraph stays faintly visible instead of appearing on hover.
- **A pane gets its size back when wherdr's terminal closes.** Opening the terminal on a phone
  resizes the real pane to about 40 columns, and with no Herdr client attached to lay it out
  again (a machine driven from afar) it stayed that narrow: the agents' screens were cut (omp's
  model selector, its status line without the model…). wherdr now remembers the pane's size when
  its first terminal opens and gives it back when the last one closes — after 2 seconds, or
  30 seconds after a connection that dropped (locked phone, lost network), so a terminal that
  comes back keeps its size. A size set meanwhile by an attached Herdr client is left alone, and
  the sizes to give back survive a restart of wherdr. The width is read from the pane's PTY;
  in Docker, where it is out of reach, the pane gets the width of Herdr's layout.
- **Docker: the machine is no longer called "wherdr"** when `HOST_LABEL` is missing from `.env`
  (the container's host name was shown, so Settings › Plugins read "wherdr · Not installed").
  wherdr then shows the name Tailscale gives the machine, and the installer writes the host's
  short name (without its domain) in `.env`. A `HOST_LABEL` you set, or a name chosen in the
  app, still wins.
- **Settings › Plugins**: the button says **Install herdr-projects** instead of **Install**.
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
