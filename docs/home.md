# Home and agent list

[Documentation](README.md) · [Project](../README.md)

## Features

### Agents on herdr-core

- **Live list** of every hc terminal, on this machine and on each core machine, refreshed from
  core's events. Terminals are placed as herdr-app places them: by their `herdr.space` /
  `herdr.tab` labels, else by the tab of the machine's herdr-app layout that holds them (space
  and tab names and the tab order come from it). Other terminals are grouped by machine and
  folder. Details in [herdr-core › Inventory](core.md#inventory).
- **States**: **Your turn** (blocked: a question or a permission), **Working**, **Ready** (idle or
  done) and **Unknown** (no status reported). A space with several terminals follows its most
  urgent one. Three counters at the top (your turn, working, ready) count the same rows as the
  headings. When core does not answer, the last list stays visible, marked offline, and the home
  says **herdr-core is not responding**.
- **Quick answers**: a waiting agent's card shows its question and options; **answer in one tap**
  without opening it. The question is read again before the answer is sent; if it changed, the
  answer is refused.
- **Compact list**: Settings › Appearance › Home screen › **Compact list** shows one line per
  card; Normal adds the current activity on a second line. **Individual agents** lists the
  terminals of standalone agent spaces one row each, with their pane or tab labels. Both follow
  you across devices.
- **Group by**: Settings › Appearance › Home screen › **Group by** chooses **Machine** or
  **State** (Your turn, Working, Ready across online machines).

### Machines as tabs

The **machine bar** at the top of the list has **All**, then one tab per machine (this core and
each core machine, online or offline) with its count of rows. A tap shows that machine alone,
with its Claude and Codex quotas at the top; an offline or reconnecting machine says so there.
Settings › Appearance › Home screen › **Machine bar** orders its items, hides some of them, or
hides the bar. In **Groups**, create a named selection of machines; groups follow you across
devices. Machines themselves are managed in [Settings › Agents › Machines](machines.md).

### New agents and tabs

- **New** opens a sheet: an agent (Claude Code, Codex…, only those installed on that machine) or
  a plain terminal, the machine, a folder (recent folders, a folder browser, Git detection), a
  name, **resume** the last conversation, and an optional first message. The terminal is started
  by core in that folder; it joins the space whose folder holds it, else a new space.
- **+** in a space's tab row starts at once a terminal like the space's current one (same kind,
  same folder) in a new tab of that space; **New tab…** in the tab menu opens the sheet. The new
  terminal carries the space's labels, so it also appears in herdr-app.
- Rename, close, split and move of spaces and tabs stay in herdr-app. Closing an agent's pane
  from wherdr ends its program.
- Worktrees, coordinators and Board tasks are v2 only.

### Search

The magnifier (⌘K / Ctrl+K) searches every agent and the conversations of the Claude Code and
Codex agents of online machines. Choosing a result opens it.

### Also

**Quotas** (remaining Claude and Codex usage, see [quotas](quotas.md)), **notifications**
([Notifications](notifications.md)), the **passkey lock** (Face ID, Touch ID, Windows Hello,
Android…) and optional [wherdr plugins](plugins.md#wherdr-plugins).

Herdr sessions, Herdr plugin actions, keep-awake and the Board are v2 only.
