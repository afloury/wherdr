# Machines

[Documentation](README.md) · [Project](../README.md)

## Several machines (SSH)

Other machines are **core machines**: herdr-core (hc) reaches them over SSH and runs their
terminals there, as `hc machine add` does. wherdr shows what `machine.list` returns; it opens no
SSH connection of its own.

- **On the home screen**, each machine is one of the machine tabs, online or offline, with its
  count of rows ([Machines as tabs](home.md#machines-as-tabs)). When a machine goes offline, its
  last terminals stay visible, marked offline, until core reaches it again.
- **New** starts a terminal or an agent on any online machine (`terminal.run` with `on`). Home,
  folders, Git detection and installed agents of that machine come from `machine.exec`; folders
  must stay under the machine's home.
- **Conversations, files and quotas** of a core machine are read through `machine.exec` on that
  machine ([herdr-core](core.md#conversations), [Files](files.md), [quotas](quotas.md)).

## Before adding a machine

On the machine to add:

- herdr-core is installed and on the `PATH` of a non-interactive SSH shell
  (`ssh laptop 'command -v hc'`). wherdr never installs it.
- This host logs in with an SSH key, without a password prompt (`ssh laptop true` answers at once
  and the host key is already accepted). wherdr never asks for a password.

## Manage machines

**Settings › Machines** shows the core's version and uptime and one card per machine, this
machine first. Each card has the same columns: the name, its state (*This machine*, *Connected*,
*Connecting…* or *Offline*), then the keep awake, rename and forget buttons at the right edge (a
button that does not apply leaves its place empty, so the buttons line up across cards). Under
the name come the last error, the keep-awake line and the battery warning, then the memory line
and the machine's memory settings (side by side on a computer, stacked on a phone):

- **Add machine** (`machine.add`): an **SSH target** (`user@host`, a `~/.ssh/config` host, or
  `user@host:port` when the core takes a port, as herdr-core 0.1.17 does; wherdr reads this from
  the core's `rpc.discover`, and on an older core the form says so before sending) and an optional
  **Name** (a-z, 0-9, `-`, `_`, `.`, 32 at most). wherdr never accepts a `via` command. Adding can
  fail with: the name is taken, the machine is already added, it cannot be reached over SSH,
  herdr-core is not installed there, or its herdr-core version is incompatible.
- **Reconnect** an offline machine (`machine.connect`).
- **Rename** (`machine.rename`): the new name follows the same rules. Only this core's name
  changes; links that use the old name stop working.
- **Forget** (`machine.rm`): this core drops the machine, but its terminals keep running there,
  and the machine can be added again later.
- **Keep awake** (the sun button on a machine's card, or **Keep awake** in its tab's menu on the
  home screen): 1 hour, 4 hours, until this evening (8 pm, machine time), until turned off, or
  extend by one hour. The card then says *Awake until 18:00* or *Awake until turned off*, and on a
  laptop on battery it warns that closing the lid puts it to sleep (or that the lid is closed).
  It runs on that machine through herdr-core (`machine.exec`): `caffeinate -i -s` on macOS,
  `systemd-inhibit --what=idle:sleep` in a `systemd-run --user` unit on Linux. Only the inhibitor
  wherdr started (same PID, command and start time) counts, and **Turn off** stops that one alone.
  A sleeping machine cannot be woken remotely. While a machine is awake and online, placement
  counts on it like any online machine.
- **Memory**: each machine's free memory, cores and load (read on Linux and macOS; on macOS the
  free figure is close to Activity Monitor's, not exact) and its agents at once (all projects), with two
  settings, both **Auto** when left empty (the grey placeholder shows wherdr's pick):
  **Agents at once, all projects** (Auto: one agent per 1.5 GB of RAM) and **Automatic
  starts wait under (GB free)** (Auto: 15 % of the machine's RAM, at least 1 GB, at most 4 GB;
  0 turns this guard off). Emptying a field goes back to Auto; a saved value stays yours. Each start goes to a machine its project allows
  where the task fits, by the project's **Placement** ([project sheet](project-management.md#general)):
  by default heavy work to the strongest one, light and standard work to the project's
  own machine when it fits; or *Balance the load*, or *Home first*. A task fits when the machine keeps its minimum free after the task's
  estimate (light ≈ 0.7 GB, standard ≈ 1.8 GB, heavy ≈ 3.9 GB), counting the agents just started,
  its swap is under 90 % used, its cores are not all taken, it runs fewer agents than its cap (yours,
  else one per 1.5 GB of RAM), and for heavy work its load is under 0.8 per core. When no machine fits, automatic
  starts (autopilot, chains, automations) wait, with each machine's reason on the card, and start
  by themselves once one has room. Your own starts still go. A task that started stays on its machine.
- **Online or offline, and available hours**: each machine, offline ones too, shows whether
  herdr-core reaches it now. Placement asks herdr-core again at each start, so a machine that just
  went offline takes nothing. A new task asked for an offline machine starts on another machine its
  project allows when one fits, else waits with *Waits for … (offline)*. **Available** (Always,
  Weekdays, Every day, with **From** and **To**, in the wherdr server's time; *To* before *From*
  runs over midnight) keeps automatic starts off a machine outside its hours, and heavy work off it
  in its last 2 hours, so a laptop that leaves at 19:00 is not handed a long build at 18:30. The
  coordinator sees the same in `autopilot show` (`machines`).
