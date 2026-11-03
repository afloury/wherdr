# herdr-core inventory

Run wherdr with `WHERDR_BACKEND=core` (at build and server startup) and
`HC_SOCKET` pointing to the socket of the desired hc session. Obtain the endpoint
from your hc configuration; wherdr requires an explicit endpoint and never starts
or installs core. This avoids accidentally selecting an inherited agent session.
The browser cannot choose the endpoint or issue arbitrary RPC calls.

Core mode uses the existing v2 home, workspace cards, tabs and agent screen.
A core poller reads `terminal.list` and `machine.list` and publishes changes through
the existing state WebSocket. The old Herdr poller, Board discovery and TUI
notifications are disabled. Network and passkey guards remain active; legacy
control routes are unavailable in core mode.

The home has one machine-bar item per machine (this core and each `machine.list`
entry, online or offline) with its counters. Terminals are placed like herdr-app
places them: by their `herdr.space` / `herdr.tab` labels, else by the tab of the
machine's `herdr-app` document whose layout holds them; the document (read only,
never written) gives the space and tab names and the tab order. Terminals with no
such placement are grouped by machine and cwd, one tab and pane per terminal.
"+" in a space's tab row (or header) starts at once a terminal like the space's current one (same kind, same folder; "New tab…" in the tab menu opens the sheet to choose). The header map button lists the space's terminals to switch between. The new terminal carries that
space's `herdr.space`, a new `herdr.tab` and `herdr.seen=0`, so it also appears in
herdr-app. Terminals made from the "New" sheet get the space whose folder holds
their cwd, else a new one. Rename, close, split and move stay in herdr-app.
Each pane preserves its full core address behind a stable interface identifier.
Agent identity uses core's `agent` field when supplied, otherwise recognised
application/template/command names. Identity does not gate status: OSC 7501
Working and Blocked lift any program's workspace into Working or Your turn.
Idle and Done appear in Ready; absent or unrecognised status appears in Unknown.
For online machines, the home counters (your turn, working, ready, unknown) count the same rows as their headings, and the machine tabs count rows too. The Herdr sessions row is hidden; `/api/phone` and a read-only `GET /api/update` (no one-tap update) answer.
A mixed workspace follows its most urgent terminal. On connection loss the last
inventory stays visible offline; subsequent polls reconcile it with core.

Opening a terminal attaches to it through `terminal.attach` on a framed connection,
one per viewer, so several viewers (phone, computer, herdr desktop) work at once.
A viewer attaches at the terminal's current size and does not resize it until the
user takes control: typing in the terminal or the composer, a key of the keybar, or
"Fit to this screen". When another viewer then sets its size, the banner returns.
The browser returns credit after xterm has written each chunk (core's 256 KiB window
bounds the relay) and scrolls the history it received locally.
The composer sends with `terminal.send` (never retried), Stop calls
`terminal.interrupt` and reports what core observed, keys use `terminal.keys`, and
closing a pane ends its program with `terminal.kill`. Controls that core does not support
yet are disabled or hidden. Without
`WHERDR_BACKEND=core`, the existing v2 application is unchanged.

Reference: [published 0.1.16 protocol](https://github.com/herdrdev/herdr-core/blob/v0.1.16/schema/README.md).
Generation 1 and both advertised method lists must support the first v3 terminal
milestone; later additive versions are accepted. Plain mode is used here;
terminal streams negotiate framed mode on their own connection. Probe connections close
after each reply and have a three-second deadline and a 16 MiB reply limit.

## Conversations

Claude Code and Codex terminals open in conversation mode, as in v2, with the same
conversation view, search, queued messages and quotas. The conversation file is found
the way v2 does for Herdr panes, from what core gives: `terminal.get` supplies the
foreground process and pid (Claude Code's `~/.claude/sessions/<pid>.json` names its
transcript), the process tree under the terminal's pid (`ps`, for an agent started by a
shell), the folder and the start time (Codex claims the rollout created right after its
terminal appeared). On a remote core machine the files are read with `machine.exec` on that
machine. A terminal that is not an agent shows only its terminal. Claude Code must keep
saving transcripts: a core started from inside a Claude Code session inherits
`CLAUDE_CODE_CHILD_SESSION`, which turns saving off; start core from a plain shell.

## Creating terminals and agents, machines

New opens the usual sheet. A terminal or an agent CLI (Claude, Codex…) is started with
`terminal.run` in the chosen folder, on this machine or on a core machine (`on`), with no
inherited parent, `wait: false` and a request label. Agents run through the machine's shell
with the usual user bin folders on `PATH`. Home, folders (browser, Git detection) and
installed agents of any machine come from `machine.exec`; folders must stay under the
machine's home. When core does not answer in time, the inventory is searched for the label:
found means created, not found is shown as "not confirmed" and is never relaunched blindly.
Board, worktree, resume and first message are not offered with core.

Claude and Codex quotas work as in v2 (home rows, Settings › Agents › Claude quotas): the server reads each
machine's quota files, this machine's from disk and core machines' through `machine.exec` (the status line
installer goes on its stdin), with a 30 s cache.

Settings › Agents › Machines lists core's machines with their state, reconnects one
(`machine.connect`) and adds one over SSH (`machine.add` with a target and an optional name,
like `hc machine add`). The target must already accept this host's SSH login: wherdr never
asks for a password, installs core on the machine, or accepts a `via` command.
