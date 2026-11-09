# Home and agent list

[Documentation](README.md) · [Project](../README.md)

## Features

### Agents on herdr-core

- **Live list** of every hc terminal, on this machine and on each core machine, refreshed from
  core's events. Terminals are placed as herdr-app places them: by their `herdr.space` /
  `herdr.tab` labels, else by the tab of the machine's herdr-app layout that holds them (space
  and tab names and the tab order come from it). Other terminals are grouped by machine and
  folder. Details in [herdr-core › Inventory](core.md#inventory).
- **States**: three only: **Your turn** (blocked: a question or a permission), **Working** and
  **Ready** (idle or done; an agent that reports no status also counts as Ready, as in v2.5).
  A space with several terminals follows its most urgent one. Three counters at the top (your
  turn, working, ready) count what the tab lists: the same rows as the headings, plus Alfred and
  the tab's running coordinators (one waiting for your answer counts in your turn). When core does not answer, the last
  list stays visible, marked offline, and the home says **herdr-core is not responding**.
  An omp card also shows its context usage as a thin line along its bottom edge (green, ochre
  from 60 %, rose from 85 %; paler when it is the last reading); the figures are in the
  conversation header. omp's own status line, gauge and welcome screen never stand as the card's
  preview.
- **Quick answers**: a waiting agent's card shows its question and options; **answer in one tap**
  without opening it. The question is read again before the answer is sent; if it changed, the
  answer is refused.
- **Compact list**: Settings › Appearance › Home screen › **Compact list** shows one line per
  card; Normal adds the current activity on a second line. It follows you across devices.
  Every agent terminal is its own row, with its pane or tab label.
- **Task agents**: an agent the [project engine](project-management.md) started for a task keeps
  its own status, but its row is named after its task: the state square, the task id badge, the
  task title (cut when long; a pane you renamed keeps your name, in the conversation header and
  search too) and how long it has been in its state (`8 min`, `2 h`). A second line gives its
  role, then its machine (when the list mixes several) and its last message: **DEV** (working on
  the task), **REVIEW**, **FIX** (sent back by the review, red CI or you) or **CATCH-UP** (merging
  the base branch). Only an agent other than Claude keeps its small icon. Several agents of the
  same task (the worker and its reviewer) share one row, in the group of the most urgent: the
  title line, then one line per agent with its own state, which opens that agent; the row's menu
  lists each agent's actions under its role. A reviewer kept between rounds shows dimmed.
- **Order**: the header (logo, version, Search, Board, Settings), the counters, the quotas (a
  machine's own quotas under them), Alfred, the [coordinators](#coordinators), then the agents of
  the machines shown, by state (Your turn, Working, Ready). When the list mixes several machines,
  each card carries its machine's name. There is no section per machine. The list never scrolls
  sideways: long titles and badges are cut with an ellipsis, and its scrollbar stays thin, shown
  while the pointer is over the list.

### Alfred

Alfred, wherdr's assistant, is always the first row of the agent list, even
with no agent and projects off. It helps you get started and, with projects
on, coordinates all of them when you ask it: it has no autopilot, each
project's coordinator runs its own. The first *Start* asks which agent (Claude,
Codex, OMP…, those offered in Settings › Agents) runs it; the choice is kept, and wherdr
never changes it on its own: if that agent is no longer offered, the **Agent**
button in Alfred's conversation opens a window that says so, and you pick another there. The same window
changes Alfred's agent for its next conversation. It runs with that agent's default
model: change the model inside Alfred. Its menu (right click, or long press on a touch
screen), *Restart with…*, moves it
to another agent at once (when an account runs out of tokens, for instance): the old session
stops and the new one carries on from the same home folder, `alfred/` in
wherdr's data folder. There, `AGENTS.md` (and `CLAUDE.md`, `GEMINI.md`,
`QWEN.md`, which point to it) is wherdr's and rewritten at each start; `identity.md` (its name and tone) and `memory.md` (what it learns about
you, cleaned up at each start) are its own. Give it another name and the row
shows it as soon as its turn ends. Alfred reads and changes projects, coordinators and settings with
[`wherdr alfred`](alfred.md): it shows you each
change first and makes it only after your yes.

### Coordinators

Under Alfred, while project management is on, one row per running project coordinator, its
project's key badge in the project's color (*[WHR] coordinator*)
([Project management](project-management.md)). A tap opens its conversation, shown as selected
while it is open. A coordinator whose terminal ended (its machine restarted, say) stays, marked
*Stopped*: a tap offers *Resume the conversation* (its last one, with the agent that ran it and
the same options) or *New conversation*; its menu (right click or long press), *Restart with…*, picks another agent,
which becomes its default: its folder and memory stay, the current session stops. A coordinator
shows only in its own row, never again among the agents.

Coordinators and **Tasks to handle** follow the [machine tab](#machines-as-tabs): a tab shows the
projects whose allowed machines it holds (a project on machines of several groups shows on each
of those tabs), **All** shows every project, and Alfred shows on every tab. An open coordinator
conversation stays open on the tabs that show its project. Notifications and the board stay
global.

### Offered agents

Settings › Agents › **Offered agents** is the one list behind every agent choice: the New
sheet, a project coordinator's agent, Alfred's. Uncheck a program to hide it everywhere; drag
a row by its ⠿ handle (or use its arrows) to reorder: the first is the default and comes first
in every picker. Programs only: each starts with its own default model, changed inside the
agent. Alfred runs with any of Claude, Codex, OMP, Pi, OpenCode, Kimi, Gemini CLI, Qwen Code,
Copilot, Amp and Droid (other programs are left out of its picker: wherdr knows no instructions
file they read). A project's coordinator runs with Claude or Codex only: they are the ones wherdr
can keep out of the project's repository (a deny rule for Claude, the sandbox for Codex). Choices and order follow you on every device.

### Machines as tabs

The **machine tabs** at the top of the list are **All**, then one tab per machine (this core and
each core machine, online or offline) with its count: the total of its counters (its rows,
Alfred and its coordinators). A tap shows that machine alone, with its projects' coordinators
and tasks to handle,
with its Claude and Codex quotas at the top; an offline or reconnecting machine says so there.
The tabs hide when they would show a single machine. A machine's actions (New agent here, Keep awake,
Reconnect, Machine settings) open on a right click or long press of its tab. With the tabs hidden,
the list shows no machine chips while every machine is online: the New sheet picks the machine.
An offline or reconnecting machine gets one compact line at the bottom (state, name, known
agents) with **Reconnect**. Claude quota setup lives in Settings › Agents only.
Settings › Appearance › Home screen › **Machine tabs** orders the tabs, hides some of them, or
hides them all. In **Groups**, create a named selection of machines; groups follow you across
devices; deleting a group puts the projects shown in it back to Automatic.
Machines themselves are managed in [Settings › Machines](machines.md#manage-machines).

A project's coordinator and its tasks to handle show on the tabs holding one of its machines
(**All** shows every project). The project sheet's **Shown in** (General tab) keeps it on one
group or on all tabs instead ([General](project-management.md#general)). Push notifications are
not filtered by tab, and the board stays the same on every tab.

### New agents and tabs

- **New** opens a sheet: an agent (Claude Code, Codex…, those installed on that machine and offered
  in Settings › Agents, in the order set there: the first is preselected) or
  a plain terminal, the machine, a folder (recent folders, a folder browser, Git detection), a
  name, **resume** the last conversation, and an optional first message. The terminal is started
  by core in that folder; it joins the space whose folder holds it, else a new space.
- **+** in a space's tab row starts at once a terminal like the space's current one (same kind,
  same folder) in a new tab of that space. The new terminal carries the space's labels, so it
  also appears in herdr-app.
- A tab's menu (right click, or long press on its chip) has **New tab like this one** (same kind
  and folder as that tab, when its folder is known), **New tab…** (opens the sheet), **Rename
  tab** (a tab of one terminal not named in herdr-app's layout: the name is stored as that
  terminal's name in core) and **Close tab**.
- A space's menu (right click, or long press on its card; on an agent's row, its Space group)
  has **Close space**, except for a project coordinator's or a task agent's space: its project
  manages it.
- Close tab and Close space first say how many terminals stop and how many agents are
  interrupted, then close each terminal as **Close this terminal** does; one that could not be
  closed is named, the others close all the same. Closing an agent's pane ends its program.
- Split and move of tabs stay in herdr-app.
- Worktrees are v2 only.

### Search

The magnifier (⌘K / Ctrl+K) searches every agent and the conversations of the Claude Code and
Codex agents of online machines. Choosing a result opens it.

### Also

**Quotas** (remaining Claude and Codex usage, see [quotas](quotas.md)), **notifications**
([Notifications](notifications.md)), the **passkey lock** (Face ID, Touch ID, Windows Hello,
Android…) and optional [wherdr plugins](plugins.md#wherdr-plugins).

Herdr sessions, Herdr plugin actions and keep-awake are v2 only.
