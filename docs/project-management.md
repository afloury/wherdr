# Project management: getting started

wherdr v3 can run your work as tasks on a board: each task goes through the
steps of its project's template, and agents do the steps. Nothing happens until
you turn it on.

The same four steps show in the app, on the **Board** while nothing is set up,
and from **Settings › Projects › Getting started**. Each step shows whether it
is done and has a button that takes you there.

1. **Turn on project management.** In Settings › Projects, switch on
   *Project management*. Off, wherdr changes nothing.
2. **Create or pick a template.** A template is the list of steps a task goes
   through, and who does each one (an agent, you, or wherdr
   itself). Under *Templates*, start from an example, such as `vibe`
   (commit straight to a dev branch, no review), change it if you want and save it.
3. **Give each project a template.** Under *Projects*, add a project (a git
   folder on a machine herdr-core reaches) or pick a template for each one in
   the list. Projects imported from v2 ([Migrate from v2](migrate-from-v2.md))
   have none, and their tasks cannot start without it.
   Quicker: **New › Project** opens a project's coordinator, or adds one from
   a git repository found on the machine, a new or empty folder (created at
   start, `git init` offered), or any folder without git (a folder of several
   projects, for instance): its coordinator works in it, but tasks need git
   for their own worktree.
4. **Open the board and start the project coordinator.** Pick the project on
   the Board and press *Start*: the coordinator is the agent you talk to about
   the project. It adds tasks and follows them on the board. Alfred, wherdr's
   assistant at the top of the agent list, coordinates all projects at once
   (see [Home](home.md#alfred)).

Then ask the coordinator for tasks, and answer
what shows under *Your turn* and *Decisions*.
