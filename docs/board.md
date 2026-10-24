# Board and coordinators

[Documentation](README.md) · [Project](../README.md)

On desktop, drag the ticket panel’s divider to adjust its width. It uses the same
handle as the navigation list: arrow keys (Shift for a larger step), double-click,
Home or Enter to restore the default width. The width is saved on this device;
the Board keeps at least 280 px when space permits. Phone panels stay full screen.

## Works great with herdr-projects

[herdr-projects](https://github.com/eliasstravik/herdr-projects) is a work board for Herdr: one
list of tasks, each handed to an ordinary agent in its own space, reviewed when it finishes and
merged on your yes. wherdr shows it on the **Board** (the button next to Settings, or `H`), for
every machine at once. It needs **herdr-projects 1.2.1 or later**; the plugin is optional.

**Install herdr-projects** in **Settings → Plugins → herdr-projects**, or on the machine. wherdr
installs the release it was tested with (1.2.21):

```sh
herdr plugin install eliasstravik/herdr-projects --ref v1.2.21 --yes
```

A machine with an older 1.x (1.2.1 or later) still works. Settings says **Update available**
there, with what the update adds, and **Update to 1.2.21** replaces Herdr's copy of the plugin;
the tasks and settings stay. wherdr reads the program's own version (`herdr-projects version`),
so a machine that ran `herdr-projects update` to a newer release is never taken back.

> **Breaking change in wherdr 2.0: herdr-projects 0.2 is no longer read.** The Project panel,
> the `TASKS.md` board, threads, thread limits and **New project** belonged to herdr-projects
> 0.2 and are gone. With 0.2 (or a 1.x older than 1.2.1), Settings and the Board say
> **Update herdr-projects to 1.2.1 or later, or downgrade wherdr to 1.3.4**, with the commands.
> The step-by-step move, with a backup and the way back, is in
> [docs/herdr-projects-1x.md](herdr-projects-1x.md). wherdr 1.3.4 is the last version
> that reads herdr-projects 0.2.

What the Board shows and does:

- **The board's groups**: needs you, ready to approve, working, to do. **Done** is history, so it
  is hidden by default: **Done · 9** at the end of the column heads (the last tab on a phone)
  shows it, newest first, the latest five then **Show all**, and hides it again; the choice is
  saved on the server and shared across devices. Headings still count done tasks. Side by side
  on a computer, one at a time on a phone. A card shows
  the task's key (`DEMO-12`), title, the line its agent reports, the agent program, progress, its
  pull request and its review (pass or fail, with the findings by severity).
- **A task** opens one compact side panel from the Board or its home row. The header names
  the machine, repo, task and agent program, with the Board's one state: Needs you, Ready to
  approve, Working, To do or Done. **Conversation**, **Terminal**, **Task** and **Settings** sit below it.
  Task holds the description, closing note, report, pull request, review findings, limits,
  token use and actions; a dot marks a new closing note or review. The agent's own Herdr state
  is in a tooltip, separate from the task's state. The panel sits beside the Board on a
  computer (with a full-screen button) and fills the screen on a phone.
- **Settings** reads the effective task settings from `show --json` on its machine when
  opened. Agent, review, plan and attempts, limits, merge and workspace settings show their
  value and source: task, repository, you, repository file or default. Source details,
  CLI notes and problems stay visible. This view is read-only; unavailable or missing data
  is stated explicitly. Board refreshes do not reread the settings.
- **Needs you** shows where the task stands now: the Board's failure or question, its command
  output and next-step hint. A failure the task has moved on from (a later stage, or its agent
  started again) is not the banner, and gets no buttons: it stays in Task as an earlier failure.
  It offers **Retry**, **Send the error to the agent** (`fix`), **Open terminal** and, when
  allowed, **Approve anyway** with confirmation. After a failed review, it lists the open
  findings (severity and subject, worst first) and offers **Send the review back to the agent**
  (`review`) first, as herdr-projects does, with **Approve anyway** after it. While the reviewer
  shows a dialog (`reviewneeds`), a reply goes to the reviewer, and wherdr says so. **Finish** (`finish`, after a confirmation)
  takes the work as it is, then runs its checks and review: offered when the agent stopped at
  a limit (Retry gives it the same limit again) or without a summary, and when its agent is at
  rest while the row stays on "Finishing". A setup failure offers **Start again**:
  herdr-projects uses `delegate` before an agent has started. With no conversation, the panel
  keeps the explanation visible instead of opening a bare shell; Terminal stays reachable
  when a pane exists. Read-only and unreachable machines cannot run banner actions.
- **A task's sheet**, from the panel's **…** button, has the same details and actions as
  the Task tab. **Open the chat** closes it and opens the conversation. When the agent has
  no pane, a field sends a reply through herdr-projects (`tell`; on a waiting plan, it sends
  the plan back).
  **Approve** merges finished work or says yes to a plan, after a confirmation; **Start**,
  **Stop**, **Retry**, **Finish** and **Archive** where herdr-projects takes them. **Start** names the agent
  the task starts with by default (its `worker.agent` and where that comes from) and offers the
  other agents installed on its machine: one picked there is for this start only
  (`delegate --worker.agent`). herdr-projects keeps that pick as the task's own setting while
  its run lasts; wherdr puts back what the task had once the run is over (back in To do, or
  done) and before its next Start, so its default, the repo's and your own settings stay as they
  are (`data/start-agents.json` remembers what to put back). A default agent not installed on that
  machine is shown but cannot be picked: Start then waits for an installed one. With every slot of
  the board taken (`board.agents` tasks at work), **Start** says **Queue** and the place the task
  would get (`delegate` queues it). **Start after…** picks tasks to wait for, by key, id or title, on
  every machine the Board reads (another machine's as `machine:KEY-12`): `delegate --after`. A task
  that waits names them, with **Stop waiting** (`after --clear`); one in the queue says its place.
  herdr-projects' refusals (a circle, an unknown task, a machine that does not answer) are shown as
  they are. After an action the sheet
  shows the task's new state, or why it was refused. **Archive** closes the sheet and takes the
  task off the Board, with **Restore** in a toast for a few seconds; **Archived** lists the
  archived tasks, whose sheet is read-only with **Restore**, as in herdr-projects.
- **Coordinators**, in the same panel: a machine's heading opens its Coordinator, the agent that
  turns what you write into tasks; a repo's heading opens that repo's project coordinator. One
  not started yet takes a first message (`coordinator tell`), which starts it. One that
  herdr-projects could not start (an agent not installed there…) says why, with **Try again**
  (`coordinator restart`) once it is fixed: the message still waiting then goes in.
- **Task identity** stays with the worker on the home list, Board card and conversation header.
  During a review, **Reviewed by** names the reviewer beside its own small logo. The conversation
  explains that it belongs to the worker and the review runs separately; **Open reviewer terminal**
  opens the reviewer's terminal when reachable, or a session switch is offered when it runs in
  another open session. After a worker fallback, the main logo names the current worker and
  **Took over from** names the previous one from the recorded handover.
- **The agent list** groups the board's spaces under their repo, as Herdr's sidebar does: each
  machine's Coordinator and machine coordinator first, each with its own icon and the Board's name (**Coordinator** with
  the board's icon, **`<machine>` coordinator** with the machine's), then per repo a head row, its project
  coordinator (named after the repo, the wherdr mark on the accent, **Coordinator**, its state; its
  question and one-tap answers when it asks one), a bar under it (fold, the tasks' summary such as `4 TASKS · 1 YOUR TURN ·
  1 LIMIT`, branch and commits behind its upstream, and the repo space's **…** menu, which opens
  its terminal), and its tasks' spaces, indented and folding with the bar (key, title, state,
  progress, time on it, the line the board reports; the Board icon opens the task there). One
  row per task: its reviewer, planner and attempts, each in a tab of the task's space, are part
  of it; in normal mode the row says the stage (**Under review · codex**), and both modes
  open the task panel while a review runs. The counters count tasks, not tabs. A repo
  coordinated from another machine shows **Coordinated from <machine>** above the bar instead
  of a local coordinator. Without either coordinator, the bar is the first row; the repo's plain
  terminal stays accessible through its **…** menu. wherdr reads this from
  the board's files (`~/.herdr-projects/data`: tasks, attempts, reviewers, coordinators, repos)
  and from Herdr's worktree groups, every 15 seconds while the list is shown, never through
  herdr-projects' command line; the branch and behind count come from `git` in the repo's main
  checkout, once a minute, without fetching.
- **Coordinator entry points**, named as herdr-projects names them, one name per level on the
  Board, the home list, the conversation header and the menus: the top of the Board offers the
  main **Coordinator** (FR **Coordinateur**), for all repos and machines it can reach. With
  several hosts, its menu lists them by name; unavailable and read-only hosts stay listed with
  their reason. Machine headings offer **`<machine> coordinator`** (FR **Coordinateur ·
  `<machine>`**: the machine as a whole, its repos and folders, its tasks and agents), repo
  headings offer **`<repo> coordinator`** (FR **Coordinateur · `<dépôt>`**: work in that repo). Hover or long-press an entry for its role;
  the conversation header repeats that description.
- **A machine is one board**, shared by its named sessions: one list, one queue, one card per
  task. A machine whose read fails says why on the Board, and its last tasks stay, marked with
  the time they were read.
- What wherdr runs, on the task's machine and in its Herdr session (on an SSH machine, its own
  session by name): `herdr-projects list --json`,
  `details <id> --json`, `show <id> --json`, `set`/`unset worker.agent --task <id>` (to put back a pick), `tell <id> <text>`, `approve <id>`, `delegate` (with `--after`), `after <id> --clear`, `stop`, `retry`,
  `archive` and `restore <id>`, `list --json --archived` (Archived), `coordinator tell <text>`,
  `coordinator status --json` and `coordinator restart` (your
  words always after `--`, so they are never read as options), through the plugin's own
  launcher (`bin/run.sh`). Each command also runs herdr-projects' own upkeep, so wherdr calls it
  sparingly: one command at a time per machine, a read every 15 seconds and only while the Board
  is open (a list less than 5 seconds old is reused), and the last list kept when a machine is
  slow or unreachable. Nothing runs where herdr-projects is missing or older than 1.2.1: its first
  run would take over an older install's files.
- **Agents in user folders**: wherdr runs herdr-projects with your [PATH](installation.md#agent-path), on this
  machine and over SSH, so `claude is not installed here` does not come from a login service's
  short `PATH`.
