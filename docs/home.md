# Home and agent list

[Documentation](README.md) · [Project](../README.md)

## Features

### Everywhere

- **Home grouping**: Settings › Appearance › Home screen › **Group by** chooses **Machine**
  (default, projects under their coordinator) or **State** (Needs you, Working, Ready merged
  across online machines). State mode adds machine and project badges to flat cards; the
  machine bar and its groups filter both modes. Compact/normal applies to both. In State mode,
  a row of machine chips at the top opens each machine's menu (sessions, keep awake, board,
  Claude quota setup), and offline or reconnecting machines stay on one line at the bottom.
- **Live agent list**, one line per Herdr space, grouped by state (your turn, working, ready).
  The list is compact by default: agent, title, project badge and state. When an agent asks for
  permission or asks a question, its card opens on the question and its options: **answer in one
  tap** without opening it; the card is one line again once answered. Turn off Settings ›
  Appearance › Home screen › **Compact list** for normal mode. Board tasks use one line in
  compact mode (agent, key, title, progress, duration, state and Your turn when needed); normal
  mode adds the current activity and relevant limit or review labels on a second line. Task
  details stay in the task sheet. Existing compact/normal choices are preserved. Other agents
  also use dense rows, with a last-answer preview in normal mode; waiting agents keep their
  questions and one-tap answers in both modes.
  With [herdr-projects](board.md#works-great-with-herdr-projects), the board's spaces follow Herdr's sidebar:
  the Coordinators on top, then one group per repo, headed by its project coordinator (the repo's
  name, the wherdr mark, **Coordinator** and its state), a bar that folds the group and sums up its
  tasks (`4 TASKS · 1 YOUR TURN · 1 LIMIT`, the branch and `↓` commits behind its upstream, the
  repo space's menu), then its tasks, indented (key, title, progress, time on it, the board's
  current line); closing a space that holds task agents names the tasks it stops.
- **New agent**: pick an installed agent (or a plain terminal), a folder, optionally a separate
  Git **worktree** and branch, resume the last conversation, and queue a first message.
- **Machine bar**: at the top of the list, “All”, then each machine with its state and count; a
  tap shows one machine alone. Settings › Appearance › Home screen › **Machine bar** orders its
  items, takes some off it or hides it (kept on the device). A machine's **…** menu opens the
  Board filtered on it (**Open the board**). In **Groups**, create a named selection of machines,
  check its members and drag their handles to set their order. Groups appear after All by default,
  with their combined task count and a group icon; order or hide them alongside the machines.
  Choosing a group shows its members in the group's order. Groups are saved on this device.
- **Named Herdr sessions**, **quotas** (remaining Claude and Codex usage limits), **Herdr plugin
  actions** in the menus, **passkey lock** (Face ID, Touch ID, Windows Hello, Android…).
