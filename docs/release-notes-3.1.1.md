wherdr 3.1.1 rounds off **workspaces**: each member setting says whether it follows the workspace, a workspace can be created from New › Project, and a worker can wait on another task. Projects can run a command when a task changes state and set a commit message template, agents can ask several questions in one card, and photo messages to Claude, message states, keep awake on a remote Mac and two Devin conversation problems are fixed. Update as usual: the banner's *Update with Alfred*, or `update.sh 3.1.1` in the install folder; no manual step is needed.

## New

**A command when a task changes state.** *On state change* in a project's General tab runs a shell command on the project's home machine when a task starts, waits for you, is done or fails, for example to sync a tracker. The task's facts come as `WHERDR_TASK_*` environment variables, and a workspace shares the command with its members. [Project management](https://github.com/afloury/wherdr/blob/v3.1.1/docs/project-management.md#general)

**Commit message template.** *Commit message* (`{tag}: {title}`…) sets the title of squash merges and of `git.land`'s merge commit, shared by a workspace like the branch name.

**Several questions in one card.** An agent can ask up to 8 questions in one card, and one *Send* answers them all in one message, in the chat and in Tasks to review.

**Waiting on another task.** A worker that reports *blocked on* a task or a repository parks without stalling and continues in the same conversation once that is done; a cycle comes to you as a decision. A coordinator can also pause a task until its machine has room, and the engine resumes it.

**A workspace from New › Project.** A *Project | Workspace* switch creates either one, with a *Browse* button beside each machine's root folder. A workspace root may itself be a git repository, adopted as a member with `repo adopt .`. [Workspaces](https://github.com/afloury/wherdr/blob/v3.1.1/docs/workspaces.md)

**Themes from Alfred.** Ask Alfred for a theme and it proposes one as a card with a preview and a contrast check. The theme editor previews a small version of the whole app and gets a *JSON* tab.

## Improved

**Workspace members.** Each shared setting of a member says *From <workspace>* or *Own value · Use <workspace>'s*, and is overridden or reset one field at a time. The workspace's working branch, branch name, placement and archive settings now reach its members, and a member with its own workflow can follow the workspace's again. In the sidebar, each member shows its own counts, and *n waiting for you* opens the waiting task.

**Settings › Projects.** *Add project*, *Add workspace* and *Open the board* sit above the list, with a tab filter, a search, and members folded under their workspace. The template library is gone from the interface: coordinators and Alfred write workflows, and saved templates stay on disk.

**Everyday use.** Every send button of Tasks to review, and keep awake, shows a loader until the server answers. A refused action offers *Try again* with the reason for herdr-core or network failures. A relative file path in a chat opens the right file. A stale *Limit reached* quota shows as unknown and no longer blocks pacing. The file browser also protects agents' credentials and `~/.config/gh`. A coordinator's header menu offers *Open the board*, its settings and *Autopilot*.

**Windows host (experimental).** wherdr starts on Windows and keeps the inherited PATH ([#870](https://github.com/afloury/wherdr/issues/870)). [On Windows](https://github.com/afloury/wherdr/blob/v3.1.1/docs/installation.md#on-windows-experimental)

## Fixed

**Photo messages to Claude.** A photo reaches Claude as an image, is never left stuck in Claude's field, and a multi-line message with a photo is submitted within about 20 s with your text kept in its bubble.

**Message states.** A message reads *Sending…* until it is in the transcript, never *Read by the agent* before, and *Not sent* only once the server gave up. A message sent at the same moment as a wake keeps its own bubble, and a running '!' command keeps its place in time.

**Devin conversations.** A Devin started without `-r` shows its conversation, and an idle Devin no longer opens the interactive terminal over it. Thanks to [@followcat](https://github.com/followcat) for both fixes.

**Keep awake** works again on a remote Mac, and a failed read says *Could not reach <machine>* with the reason.

**Tasks.** A review round adds to the task's report instead of replacing it, a coordinator's first messages survive a restart, and a failed migration never stops the board.

[Full changelog](https://github.com/afloury/wherdr/blob/v3.1.1/CHANGELOG.md)

Join us on Discord: https://discord.gg/ky36WYmtVE
