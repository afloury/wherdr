wherdr 3 runs on [herdr-core](https://github.com/herdrdev/herdr-core) (`hc`) instead of Herdr, and adds built-in project management: you talk to a project's coordinator, agents carry its tasks through your workflow on a board, and Alfred, wherdr's assistant, helps you set it up. It installs from source **beside** wherdr v2, imports v2's machines and settings, and leaves v2 untouched, so you can compare both and go back at any time.

## New

**Projects, board and tasks.** Turn project management on, add a project from a repository on any machine, and its tasks go through the steps of its workflow on a board, done by agents. Start a workflow from a built-in example or one of your saved templates. Guards set the protected branches and whether a merge waits for you or is done by wherdr. The task sheet shows the time per step, the waits for you, review rounds and CI fixes, with the task's description, plan and log. Tasks that change the same files do not run at the same time.

**A coordinator per project.** You talk to the project's coordinator: it adds tasks and follows them on the board. It keeps its own memory of your decisions and preferences across restarts and changes of agent. Its autopilot keeps the board busy within its limits and hours, and Pace decides when automatic work may start against your Claude and Codex quotas.

**wherdr handles the routine blocks.** A merge queue merges ready PRs one after the other. A PR in conflict or behind its base, red CI from an infrastructure error, a push refused because the branch is behind, and a stalled agent are handled by wherdr, or handed to the task's agent, before the coordinator is woken up. Work cut by a restart or a crash resumes by itself.

**Alfred.** wherdr's assistant guides the first setup, reads your v2 board when you bring projects over, and changes settings only after your yes.

**Machines.** Each task goes to a machine its project allows, by memory, cores and load. Keep a machine awake from wherdr, set the hours it takes automatic work, or pause it for one project. A project shows on the home tabs of its machines.

**Agents show instead of tell.** Agents ask a choice with buttons and show a task as a live card; Alfred and coordinators also highlight a setting, show status cards and propose a setting change as a card you apply.

**Conversations.** On-device dictation, and a neural read-aloud voice that runs on the phone. Devin conversations open on their transcript. SVG diagrams show as a safe preview. Conversations are lighter and faster, also with many agents: wherdr reads only what a transcript added and keeps the last read on the device.

## Update

wherdr 3 is a new install, not an in-place update of v2. What changes, what v2 alone keeps, and how to move are below.

### Changed

- herdr-core (`hc`) replaces Herdr, and other machines are hc machines reached over SSH.
- wherdr installs from source and runs as a user service.
- Beside v2, it has its own port, data folder, service and address.
- To update, pull and rebuild; a small machine can instead receive builds made on another machine of your tailnet.

### Gone (v2 only)

- Herdr sessions, the Herdr plugin and its actions, and the relay of Herdr notifications.
- The herdr-projects board: v3 has its own projects and board.
- The npm and Homebrew packages, the curl installer, Docker and the one-tap update.
- Worktree management and the Changes view.
- The model and effort pickers and the slash-command list.
- Split panes: with hc, every terminal of a space is a tab; split and move stay in herdr-app.

### How to move

Follow [Migrate from v2](https://github.com/afloury/wherdr/blob/v3.0.0/docs/migrate-from-v2.md). Its installer script runs on the machine that runs v2, prints its plan first, and imports v2's SSH machines and synced settings. Alfred then sets up your v2 projects with you, one at a time. Passkeys and push notifications are added again in v3.

### Known limitations

- The install script needs Linux with `systemd --user`; on macOS, install by hand.
- The build needs about 1.5 GB of memory.
- hc is not installed for you: install it first.

[Full changelog](https://github.com/afloury/wherdr/blob/v3.0.0/CHANGELOG.md)
