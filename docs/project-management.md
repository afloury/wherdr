# Project management

[Documentation](README.md) · [Project](../README.md)

wherdr v3 can run your work as tasks on a board: each task goes through the
steps of its project's workflow, and agents do the steps. Nothing happens until
you turn it on.

## Getting started

The same four steps show in the app, on the **Board** while nothing is set up,
and from **Settings › Projects › Getting started**. Each step shows whether it
is done and has a button that takes you there.

1. **Turn on project management.** In Settings › Projects, switch on
   *Project management*. Off, wherdr changes nothing.
2. **Pick a template.** A template is a list of steps a task goes through, and
   who does each one (an agent, you, or wherdr itself). Start from an example,
   such as `vibe` (commit straight to a dev branch, no review), or from a
   template you saved from another project ([Workflow](#workflow)).
3. **Give each project a workflow.** *Add project* (Settings › Projects, or
   **New › Project**) adds a git folder on a machine herdr-core reaches, and
   copies the template you pick into the project: that copy is the project's
   own workflow. Projects imported from v2 ([Migrate from v2](migrate-from-v2.md))
   have none, and their tasks cannot start without it: open the project, then
   *Workflow › ⋯ › Start over from a template*.
   **New › Project** also opens a project's coordinator, or adds a new or empty
   folder (created at start, `git init` offered), or any folder without git (a
   folder of several projects, for instance). A folder without git needs no
   template: it has no tasks (a task needs git for its own worktree), and its
   coordinator does the work in it directly.
4. **Open the board and start the project coordinator.** Pick the project on
   the Board and press *Start*: the coordinator is the agent you talk to about
   the project. It adds tasks and follows them on the board. Alfred, wherdr's
   assistant at the top of the agent list, coordinates all projects at once
   (see [Home](home.md#alfred)).

Then ask the coordinator for tasks, and answer what shows under *Your turn* and
*Decisions*.

## Projects

**Settings › Projects** holds the *Project management* switch, *Getting started*,
and the project list: each row shows the name (with a **Public** badge for a
public repository), the key, the machine and the folder. *Add project* opens the
New sheet on a new project; *Open the board* goes to the board. A row opens the
project's sheet, with five tabs: General, Workflow, Guards, Automations and
Autopilot. Its ⋯ menu removes the project from wherdr, after a confirmation:
its folder, branches and task worktrees stay on the machine.

### General

- **Name** and **Key**. Task ids start with the key. Change it and every task,
  old ones too, shows the new key; links and commands with a former key still work.
- **Base branch**: the project's working branch. New tasks start their worktree
  from it, and a step that names no branch opens its PR to it or merges into it.
  Pick one of the repository's branches or type a name; unset, the repository's
  current branch. A running task keeps the branch it started with.
- **Agents**: the worker and the reviewer its tasks start with, each with an
  optional model (empty: the agent's default).
- **Repository**: public or private, as wherdr found it (*Check again*) or as
  you set it. A public repository gets the coordinator's public-repository rules.
- **Template**: the template the workflow was copied from, for information
  only: a later change to the template does not reach the project.

### Workflow

The project's own workflow: its task types, and the steps of each. Each step
has an id, a column on the board, who holds it (worker, reviewer, coordinator
or none), how it ends (a report, a verdict, you, or an action) and, for an
action, what it does: land on a branch, push, open a PR, merge a PR, or check
that a branch was merged, with its branch, merge method and required checks.
Under the form, the plan of the chosen task type. *Save* checks the workflow
and shows each problem with its line.

The ⋯ menu adds *Edit as JSON*, *Change log*, *Save as template* (copies the
saved workflow into your templates; the project is untouched) and *Start over
from a template* (pick a template or an example, read the difference, replace).
Neither *Save* nor *Start over* changes the project's [guards](#guards).

### Guards

Needs: [Workflow](#workflow).

Guards are the rules on branches: the **protected** branches, who may merge into
them (by default only you), and who may merge into the others (by default wherdr
itself, when a step says so). They come from your settings, the project, a task
type and a task; the strictest wins, so a task type or a task can only make them
stricter. A project can also let its coordinator merge an outside contributor's
PR after your yes: never, into the branches not reserved for you, or into any.

The Guards tab is not editable yet: ask Alfred, who changes them with
[`wherdr alfred project guards`](alfred.md) after your yes. A project
coordinator can never change them.

### Automations

Each automation adds a task and starts it at once, on a **schedule** (`every 2h`,
`daily 09:00`, `mon,thu 09:00` or a cron, in this machine's time) or on an
**event**, with an optional filter on the task's title. Each has its prompt (the
task's description), its task type, a switch, its last firings and *Run now*.

### Autopilot tab

The project coordinator's [autopilot](#autopilot), as in its window, and a link
to the [pace](quotas.md#pace) of every account.

## Autopilot

On the board and in a coordinator's conversation, the **Autopilot** button in
the header shows the autopilot's state (green square: on; hollow: asleep) and a
count of what waits for you: a template change the coordinator proposed, or a
kept conversation that ran with another agent. A tap opens its window:

- the agent that answers the coordinator, and a warning when its conversation
  ran with another one; on the board, *Open* opens or starts it;
- the proposed template change: *Show diff*, *Accept* or *Refuse*;
- the autopilot: a switch, a **goal**, how often it wakes (*Every*, *At*), its
  limits (*Tasks / day*, *At once*), the events it wakes on (*Task added*, *Task
  done*, *Task stuck*, *Ready for you*) and *Look for new work* (scheduled wakes
  even with nothing to do, with its own *New tasks / day*). The form says
  *Unsaved changes* until you save;
- its wakes, each created, delivered and acknowledged, and *Run now*.

Automatic work (the autopilot, automations) waits while an account is ahead of
its [pace](quotas.md#pace) or a machine is short on memory
([Machines](machines.md#manage-machines)); your own starts never wait.

## Board

The header has **Decisions** (with a count when some wait), **Add task**, the
project picker (*All projects* or one), a tag filter when tasks have tags, and
the [Autopilot](#autopilot) button. The first column is **Your turn**, then the
project's columns, or *To do*, *Working* and *Done* for all projects.

A card shows the task's title, its id and step, a dot with its agent's state
(worker or reviewer), where its PR stands (*PR open · waiting for checks*,
*checks failed*, *merging*, *blocked: …*, *merged …*), what you have to do under
Your turn, the tasks it waits for, its first tags and its PR link. Its menu (right
click, long press, or ••• when it has more than *Open*) offers:

- **Start**, on a task to do that waits for no other task;
- **Stop…**, on a running task: its agent ends, the worktree, branch and work
  stay, and nothing is merged;
- **Continue**, **Take it as it is** or **Archive**, on a stopped task;
- **Delete…**, on a task never started (no agent, worktree or branch). A task
  other tasks wait for cannot be deleted; its number is never given again.

**Add task** opens a sheet: the project, a title, the task type (with its steps
in one line), a Markdown description, the tasks it waits for, and *Start now*.

## Task sheet

A card opens the task's sheet: its id and step, a note when it waits or was
stopped, and its buttons (*Start*, *Open the agent* or *Open the reviewer*,
*Stop*, *Delete…*). Below, tabs: **Description** (text, tags, links and the PR),
**Plan** (each step with its column, holder, send-backs, instructions, proofs
and screenshots) and **Log**. A refused merge says why under its button.

### A task waiting for you

Open a task under *Your turn* and its sheet starts on **To do**: what the task
needs from you and the buttons for it, before its Description, Plan and Log.

- **A visual change to merge**: its screenshots large (swipe between them, tap
  one to zoom; each is labelled phone or desktop), the review's verdict, the PR,
  then *Merge*, or *Send back* with a note: the agent gets your note as what to fix.
- **A review to settle** after several send-backs: each choice the engine offers,
  with what it does.
- **A stopped task**: who stopped it and why, then *Continue*, *Take it as it is*
  or *Archive*, each with what it does.
- **A step that ends with you** (*Merged*, or the step's own button): what to do,
  and its button.
- **An agent's question or permission**: its text, and a button to open that agent.
- **A refused merge or a blocked task**: the reason in plain words, and what you
  can do (try again, start it, open its agent).

### Agents of a task that waits for you

Needs: [A task waiting for you](#a-task-waiting-for-you).

A task under *Your turn* (a step you end, a merge only you may do, a failure)
keeps its agents only for a while: once they have been idle for 10 minutes,
wherdr ends them to free the machine's memory. The worktree, the branch and
the files stay, and the card shows the task as before. When the task needs an
agent again (you send it back, a merge finds a conflict, CI goes red, new
commits need a review), wherdr starts the worker or the reviewer again in the
same worktree, with a note on where the work stands. The task's log says when
its agents were ended and started again.

A machine's cap of agents (Settings › Machines) counts only the agents working
on a step: not those of a task that waits for you, and not the coordinators.
Its free-memory threshold still holds automatic starts.
