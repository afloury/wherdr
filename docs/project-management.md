# Project management

[Documentation](README.md) · [Project](../README.md)

wherdr v3 can run your work as tasks on a board: each task goes through the
steps of its project's workflow, and agents do the steps. Nothing happens until
you turn it on.

## Getting started

A setup window walks you through six steps for one project, one per screen,
with Back and Next. Each step does the thing in place; Next waits until it is
done. While no project went through every step, the **Board** header shows
*Finish setup (2/6)*, which opens it at the first step left; once one project
is set up, the button is gone. **Settings › Projects › Set up a project** opens
it too, on the first project with a step left, and *Add project* opens it on a
new project.

1. **Turn on project management.** Off, wherdr changes nothing. This first
   screen also offers *Let Alfred guide me*: it opens Alfred's conversation
   (see [Home](home.md#alfred)) and asks it to walk you through the setup.
2. **Add a project.** Pick the machine, then a git repository found there or
   any folder (a new or empty one offers `git init`); name, key and color
   follow the folder and can be changed. Once added, wherdr checks whether the
   repository is public; correct it if the check is wrong. With several
   projects, pick the one to set up, or add another.
3. **Choose its workflow.** The examples, each with its steps in one line, such
   as `vibe` (commit straight to a dev branch, no review). The one you choose is
   copied into the project: that copy is the project's own workflow, changed
   later in its [Workflow](#workflow) tab. Projects imported from v2
   ([Migrate from v2](migrate-from-v2.md)) have none, and their tasks cannot
   start without it.
4. **Check its guards.** The protected branches and who merges, as the
   workflow set them ([Guards](#guards)). Change and save them, or keep the
   defaults with Next.
5. **Start its coordinator.** Pick the agent and start it: the coordinator is
   the agent you talk to about the project. It adds tasks and follows them on
   the board. Its [autopilot](#autopilot) can be set under it (optional).
   It keeps a memory of its own, `memory.md` in its folder: your decisions
   and preferences, read at each start. wherdr never rewrites it, so the
   coordinator remembers them after a restart or a change of agent (Claude,
   Codex…).
6. **Add a first task.** A title and, with several, its type.

**New › Project** also opens a project's coordinator, or adds a new or empty
folder (created at start, `git init` offered), or any folder without git (a
folder of several projects, for instance). A folder without git needs no
workflow: it has no tasks (a task needs git for its own worktree), and its
coordinator does the work in it directly. A folder typed, chosen with
**Browse** or picked in the repository list fills the name and key the same
way, and one under the machine's home shows as `~/…`. On a computer the sheet
is wider, with a taller repository list.

Then ask the coordinator for tasks, and answer what shows under *Your turn* and
*Decisions*.

## Projects

**Settings › Projects** holds the *Project management* switch, *Set up a project*,
the project list and the [template library](#template-library): each row shows
the name (with a **Public** badge for a public repository), the key, the machine
and the folder. *Add project* opens the setup window on a new project; *Open the
board* goes to the board. A row opens the
project's sheet, with five tabs: General, Workflow, Guards, Automations and
Autopilot. Its ⋯ menu removes the project from wherdr, after a confirmation:
its folder, branches and task worktrees stay on the machine.

### General

- **Name**, **Key** and **Color**. Task ids start with the key. Change it and every task,
  old ones too, shows the new key: on the board, and in what wherdr writes for you
  and its agents (wakes, notifications, task logs, PR titles, `wherdr pm` outputs,
  branches of tasks started from then on); texts written before the change read the new key too. Links and commands with a former key still work.
  The color, picked from a small palette, is the project's key badge everywhere:
  its coordinator row and conversation header, board cards, the task sheet, its
  task agents' headers and *Tasks to handle*.
- **Base branch**: the project's working branch. New tasks start their worktree
  from it, and a step that names no branch opens its PR to it or merges into it.
  Pick one of the repository's branches or type a name; unset, the repository's
  current branch. A running task keeps the branch it started with.
- **Branch name**: the template each new task's branch is named from, for
  repositories that require names such as `feature/PROJ-12-fix-login`. Fields:
  `{id}` (the task id), `{tag}` (the card's ticket key, such as `PROJ-12`, else
  its first tag, else the task id), `{type}` (`bugfix` for a task type whose name
  has *bug* or *fix*, else `feature`) and `{slug}` (the title in lower case, cut
  to 40 characters). Example: `{type}/{tag}-{slug}`. It needs `{id}` or `{tag}`;
  characters git refuses are dropped. Empty: `task/{id}`. The name is set at the
  task's first start: a later title, tag or template change leaves it alone.
  When the worker pushes to another branch (it checks one out, or its note has a
  `Branch: <name>` line or a link with `?source=<branch>`, as a Bitbucket pull
  request link), wherdr follows that branch: its pushes, PR and merge checks
  use it, never the old one.
- **Agents**: the worker and the reviewer its tasks start with, each with an
  optional model (empty: the agent's default), and the reviewer's optional
  **Fallback** (see [Reviewer fallback](#reviewer-fallback)).
- **Repository**: public or private, as wherdr found it (*Check again*) or as
  you set it. A public repository gets the coordinator's public-repository rules.
- **Based on**: the template the workflow was copied from and its version, for
  information only: a later change to the template, or its deletion, does not
  reach the project.
- **Machines**: the machines its tasks may run on. The first is the project's
  own (*Home*, its folder), read only. *Add a machine* picks one of the connected
  machines and takes the path of the repository's clone there (`~/project`); once
  saved, wherdr runs that machine's readiness check (see *Start on…* under
  [Board](#board)) and shows *Ready* or what is missing. Each machine shows its
  last check (*Not checked yet* before the first); ↻ runs it again. ✕ removes a machine:
  new tasks no longer start there, tasks already there stay. Its switch off pauses it
  for the project instead, its clone kept ([Pause a machine for a project](machines.md#pause-a-machine-for-a-project)). Alfred does the
  same with `wherdr alfred project machine add|remove` ([Alfred](alfred.md)).
  **Placement** chooses how new tasks spread over these machines: *Heavy to the
  strongest* (the default: light and standard work at home when it fits, heavy
  work on the machine with most room), *Balance the load* (each task on the
  machine with the largest share of memory and cores left after it) or *Home
  first* (other machines only once home is full). A machine fits a task when
  its free memory covers the task's estimate plus the machine's reserve
  (Settings › Machines). An idle machine (no wherdr agent at work there) always
  takes one task its RAM can hold, even with less free memory than that: the
  reserve only holds its second task and beyond; on macOS a *critical* memory
  pressure still holds every task. A task that waits for room names it, and so does the
  coordinator's `autopilot show`. A task too big for every machine it may use
  (their RAM less the reserve is under its estimate) runs on the best one
  instead of waiting forever, and its log says so once. A worker started
  again in its worktree (a catch-up, red CI, a send-back, the step it is woken
  for) is weighed by what it does, not by its type: heavy only while its step
  still lacks its screenshots, standard otherwise.
- **Shown in**: the home tab that shows the project's coordinator and its tasks
  to handle, saved at once. *Automatic* (the default, with the groups it means
  in brackets): every tab holding one of its machines, so a project whose
  machines are in several groups shows on each of them. A machine paused for
  the project is left out, unless one of its tasks still runs there. Or one machine group,
  or *All tabs*. Without a machine group the sheet points to Settings ›
  Appearance › Machine tabs; deleting a group puts the projects shown in it
  back to Automatic ([Machines as tabs](home.md#machines-as-tabs)).

### Workflow

The **Workflow** is *how each task runs, step by step*; the
[Autopilot](#autopilot) is *when the project works without you*. The tab
starts with that line and a link to the Autopilot tab (who starts tasks and
when), then draws the first task type's steps as a row of linked boxes (for
example work → pr → review → merge), each with who holds it.

The project's own workflow: its task types, and the steps of each. Each step
has an id, a column on the board, who holds it (worker, reviewer, coordinator
or none), how it ends (a report, a verdict, you, or an action) and, for an
action, what it does: land on a branch, push, open a PR, merge a GitHub or
Bitbucket PR, check that a branch was merged, or watch a pipeline, with its
branch, merge method and required checks.

A **pipeline watch** (`pipeline.watch`) has the engine follow CI or a deploy
by itself, so no agent is woken only to read *still running*. It checks every
`every` (default `1m`) until `timeout` (default `30m`). Its `source`:

- `github` (default): the GitHub Actions runs of the task's commit, or of
  `branch`'s commit on origin now (no run yet: still running, so an earlier
  commit's green run never counts); `workflow` keeps one workflow only.
- `command`: `command`, run in the task's worktree on the project's machine,
  exits `0` done, `1` failed, `2` still running: a CircleCI or Bitbucket
  check, a `helm` or `kubectl` status, a health URL. Its output is the step's
  proof.

Green: the step ends, and the coordinator is not woken. Failed (which run and
job, and the tail of the output) or past its timeout: the task's log and the
coordinator get it once, and the step comes to you, or goes back to the worker
with `"onFail": "worker"` (a timeout always comes to you). A step that had the
coordinator watch the deploy with a recheck becomes, in *Edit as JSON*:

```json
{ "id": "deploy", "column": "Deploy", "ends": "action",
  "action": { "kind": "pipeline.watch", "branch": "develop", "every": "2m", "timeout": "90m" } }
```

or, outside GitHub, `"source": "command", "command": "./scripts/ci-status.sh develop"`.

A merge that first pushes the task's last commits waits up to a minute for
GitHub to show them on the PR.
In JSON, a task type may set `weight` (`light`, `standard` or `heavy`, see
*Add task* under [Board](#board)). Under the form, the plan of the chosen task type. *Save* checks the workflow
and shows each problem with its line.

**Bitbucket Cloud.** A worker step can open the PR with the agent's own
Bitbucket tool (`evidence: ["link"]`). Then either a step that ends with you and
checks the merge (`action: { kind: "git.verify-merged" }`: you merge on
Bitbucket, then press its button), or a step that lets wherdr merge
(`action: { kind: "bitbucket.merge" }`): it finds the task's open PR on
Bitbucket, waits for its builds (and the step's required checks, by name or
key), then merges with a **merge commit** unless the step names another method
(a squash makes a new commit that a later `git.verify-merged` cannot find). A
PR into a protected branch waits for you, as on GitHub, and a merge Bitbucket
refuses (approvals, branch restrictions) says why. The credentials come from
the machine that runs the task: `BITBUCKET_TOKEN` (an access token), or
`BITBUCKET_USERNAME` with `BITBUCKET_APP_PASSWORD`, in the environment
herdr-core runs with; wherdr never stores them.

The ⋯ menu adds *Edit as JSON*, *Change log*, *Save as template* (copies the
saved workflow into your templates; the project is untouched) and *Start over
from a template* (pick a template or an example, read the difference, replace).
Neither *Save* nor *Start over* changes the project's [guards](#guards).

When the project's coordinator proposes a change to the workflow (only after
your request), a square marks the project's row (*1 to review*) and the
**Workflow** tab, whose first row, *Change proposed by the coordinator*, opens
the review: the change in one line, who proposed it (the project's coordinator,
with the project's colored key, or Alfred), your request that led to it, in
full (*Show all* unfolds a long one) with its time, then the change, *Refuse*
or *Accept*. The review opens on *Readable*: per task type, its steps with the ones added,
removed or changed marked, and each changed field before → after (holder, ends,
action, merge rule, guards; instructions as a text diff). *JSON* shows the raw
diff. A proposal made before the workflow changed again is refused, and the
review says so: ask the coordinator to propose again. The *Decisions* view links to this review. [Alfred](alfred.md) can propose
a change too, on your request in its chat: you answer it in the same review.

In the coordinator's conversation, a *Workflow change* card follows the message
that made the proposal: what changes in one line, the steps of the first
changed task type before and after (the steps added or handed to someone else
are outlined), who proposed it, your request with its
time and *Go to message* (back to it in the conversation), *Accept*, *Refuse*
and *See all changes* (the review). Once answered, the card shows the outcome, by whom and
when.

#### Reviewer fallback

The workflow's `prefs` (template, task type or task, the nearest wins) say
which agents a task uses: `agent` and `model` for the worker, `reviewAgent`
and `reviewModel` for the reviewer (another model than the worker's, or
`"same"`: a fresh session of the worker's model, with the worker's agent).
`reviewFallbackAgent` and `reviewFallbackModel`, always set together, name the
reviewer to start instead when the review agent's account is out of quota on
the task's machine. Any pair works, and nothing is picked for you:

```json
{ "agent": "claude", "model": "claude-opus-5-5",
  "reviewAgent": "codex", "reviewModel": "gpt-6.1-sol",
  "reviewFallbackAgent": "claude", "reviewFallbackModel": "same" }
```

or a Claude reviewer with a Codex fallback:
`"reviewModel": "claude-sonnet-5-5", "reviewFallbackAgent": "codex", "reviewFallbackModel": "gpt-6.1-sol"`.
The fallback follows the reviewer's rules; *Save* refuses one that breaks them,
or one of the two prefs without the other.

Before it starts a reviewer, wherdr reads the review agent's account (the
reading of the home screen and pacing): at its limit and not yet reset, the
fallback reviews instead. A reviewer that hits its limit during a review (an
*account limit* [incident](#why-agents-are-gone)) is replaced at once by the
fallback, which reviews from the start. Each switch is in the task's log
(*review: Codex out of quota until 14:52, reviewed by claude claude-opus-5-5*)
and on the review step of the task sheet's Plan. The next review uses the
review agent again once its quota is back. Leave both out (as in the example
templates) for no fallback: nothing changes, the review waits for the review
agent.

### Guards

Needs: [Workflow](#workflow).

Guards are the rules on branches: the **protected** branches, who may merge into
them (by default only you), and who may merge into the others (by default wherdr
itself, when a step says so). They come from your settings, the project, a task
type and a task; the strictest wins, so a task type or a task can only make them
stricter. A project can also let its coordinator merge an outside contributor's
PR after your yes: never, into the branches not reserved for you, or into any.

In the **Guards** tab:

- **Protected branches**: one chip per branch; type a name and press *Add*, or
  press × on a chip to unprotect it. wherdr never pushes to a protected branch.
- **Who merges into protected branches** and **who merges other branches**:
  *You* (the step waits for you) or *wherdr* (it merges by itself, a
  protected branch too). A task already waiting for you at a merge that a
  change gives to wherdr goes on at once: the engine runs the step again,
  and the task's log says why. A merge left to you that you do on GitHub
  ends the step as merged within a minute: the task goes to *Done*. A merge
  cut by a restart of wherdr (an update, a new build) goes on by itself:
  wherdr asks GitHub where the PR stands.
  Merged, the task goes on (its log says *merged before the restart*); closed
  without a merge, it waits for you with that reason; still open, the merge
  runs again, at most twice, then waits for you. A restart waits up to 20 s
  for a merge that runs.
- **Effect**: what each task type adds and, for each step that merges, whether
  it is left to you. It follows your changes before you save.

Only you, or Alfred (with [`wherdr alfred project guards`](alfred.md) after
your yes), can change guards: a project coordinator never can.

A message that sends you to a tab of the project sheet names it as
*Settings › Projects › KEY › Guards*; an agent also gives its in-app address,
`#/settings?section=projects&project=KEY&tab=guards` (tabs: `general`,
`workflow`, `guards`, `automations`, `autopilot`).

### Automations

Each automation adds a task and starts it at once, on a **schedule** (`every 2h`,
`daily 09:00`, `mon,thu 09:00` or a cron, in this machine's time) or on an
**event**, with an optional filter on the task's title. Each has its prompt (the
task's description), its task type, a switch, its last firings and *Run now*.

### Autopilot tab

The project coordinator's [autopilot](#autopilot), as in its window, under its
line (*when the project works without you*) and a link to the Workflow tab
(the tasks it starts follow it), and a link to the [pace](quotas.md#pace) of
every account.

### Template library

**Settings › Projects › Template library** lists your saved templates (each
with its version) and the built-in examples. Tap one to read it: the plan of
each task type, then its JSON. A saved template's ⋯ menu renames it (its version
and change log come along) or deletes it, after a confirmation. A project never
follows the library: it starts from a copy (*Add project*, or *Workflow › ⋯ ›
Start over from a template*), so renaming or deleting a template changes no
project. To change a template, change a project's workflow, then *Save as
template*.

## Autopilot

Each project has its own autopilot, run by its coordinator; Alfred has none and
acts only when you ask it (in Alfred's conversation, the header's **Agent**
button only picks its agent). On the board with a project picked, and in a
project coordinator's conversation, the **Autopilot** button in the header (a
clock) shows the autopilot's state (green square: on; hollow: asleep) and a
count when the kept conversation ran with another agent. It is only about the
autopilot: a workflow change the coordinator proposed is a *Workflow change*
card in its conversation (see [Workflow](#workflow)). A tap opens its window,
under the autopilot's line and a link to the project's Workflow tab:

- the agent that answers the coordinator (Alfred's too), and a warning when its conversation
  ran with another one: *New conversation* with the default, or *Resume* the one kept (for
  Alfred, the agent resumed becomes its default); on the board, *Open* opens or starts it; when its
  conversation stopped (its terminal ended, for example when its machine
  restarted), *Resume the conversation* takes it up again with the agent that
  ran it, and *New conversation* starts a new one;
- the autopilot: its state and next wake, a switch, a **goal**, how often it wakes (*Every*, *At*), its
  limits (*Tasks / day*: up to 1000, empty for no daily limit; *At once*: empty is *Auto*, as many as the project's
  machines have room for; both empty for a new project, while a project that
  kept the older defaults (10 a day, 2 at once) keeps them, with the hint *Older
  defaults: clear the fields for unlimited and Auto*; a task whose step
  holds no agent, such as a PR or merge waiting for checks or the queue, or a
  step of yours, takes no slot), the **Health check** interval (empty: every
  3h; `off`: never; see [Who sends a wake](#who-sends-a-wake)), the routine
  events it wakes on, all off by default since the engine handles them (an
  autopilot saved earlier with the old default, *Task done* and *Task stuck*,
  has them turned off once; turn them back on if you want them; *Task added*: by someone else than this
  coordinator, such as you, another coordinator or an automation; *Task
  done*, *Task stuck*, *Ready for you*) and *Look for new work* (scheduled wakes
  even with nothing to do, with its own *New tasks / day*), and **Keep the
  board busy** (see below). The form says *Unsaved changes* until you save;
- its wakes and *Run now*: one line for the last wake (*Last wake 15:44*, its
  reason, *handled* or how it ended), a highlighted line for each other wake not
  handled (waiting, no answer, timed out, coordinator gone), and *History* folds
  the full list, each wake with its id, created, delivered and acknowledged times.

Automatic work (the autopilot, automations) waits while an account is ahead of
its [pace](quotas.md#pace) (a machine whose account waits is skipped) or no
machine the project allows has room for the task
([Machines](machines.md#manage-machines)), whatever the task counts; your own
starts never wait. The autopilot's limits and hours (*Tasks / day*, *At once*,
the hours) hold automatic work only too: a start you ask Alfred or a coordinator
for goes at once, with a word when it goes past one (*started; past the
autopilot's limit of 3 at once*), and still counts in them.

**Keep the board busy** (on by default while the autopilot is on): the engine
itself starts the next task to do, in [board order](#board-order), whenever a machine the project
allows has room, within the autopilot's limits, hours and pace. It never starts
a task that waits for its *after* tasks (those start once they are done), nor
one already under way, and each start goes in the task's log (*started by the
autopilot: room on* a machine) without waking the coordinator. Turn it off to
leave every start to the coordinator's wakes and to you.

The coordinator sees the same with `wherdr pm autopilot show`: whether Keep the
board busy is on and the task it starts next (or why none), the project's
placement strategy, one line per machine the project allows (memory, cores and load, its agents at work by
weight, and the heaviest weight it takes now, or why none: full, not ready,
paced, offline), and what each weight counts (*light* ≈ 0.7 GB, *standard* ≈
1.8 GB, *heavy* ≈ 3.9 GB at first) with the weight of each task type. While a
task runs, the engine measures the memory its worktree's processes take (the
agent, builds, tests, the dev server and its browser). Once 3 runs of a weight
have a measured peak in the project, that weight counts the largest of its
last 5 peaks plus 15 %, for example `heavy ≈ 2.7 GB, 2 cores (from 5 runs)`. `show <task>`
gives the machine a started task runs on. Its instructions say the engine
places tasks, `task start --on` picks a machine and `task add --weight` sets a
weight that differs from the task type's.

### Who sends a wake

A wake is a message wherdr sends the coordinator; its first line names who
sends it. The conversation shows it apart from your messages, as a compact
muted row across the column: the kind as a small coloured tag, its first
reason (*Scheduled wake*, *WHR-9: stuck: …*) and its time; a tap opens the
full text and the coordinator's whole turn. Once that turn is over, the
coordinator's last answer sits under the row, smaller and muted, two lines at
most. Consecutive routine wakes (no incident, nothing changed: no file edit
nor `wherdr pm` command beyond `ack`, `read`, `list`, `show`, `incidents`,
`help`; an answer that asks nothing) fold into one row, *3 routine checks,
08:00–11:00*, that opens on tap. An incident, or a wake whose answer asks you
something, keeps its row (in its stronger colour); an answer that asks you
stays a full reply, with its answer buttons:

- **Autopilot**: the autopilot's scheduled wakes, what needs judgment (an
  agent's question that is not a permission request, the choice after N review
  rounds), the routine events you turned on and *Run now*;
- **Step check** (`Step check: CO-1 (deploy)`): a step the coordinator holds,
  such as *watch the deploy*, at its start, each `recheck` and its timeout. It
  comes even with the autopilot off;
- **Engine**: wherdr gave up on a block after failed fixes
  ([What wherdr fixes on its own](#what-wherdr-fixes-on-its-own));
- **Health check**: every 3 hours by default (the autopilot's *Health check*
  field), a short summary of the project: tasks done since the last check,
  tasks waiting for you, tasks stalled for over an hour, and machines idle
  while to-do tasks wait. When nothing is wrong the coordinator acks it with no
  further work; with nothing at all to report, no wake is sent.
- **Incident**: [the incident wake](#the-incident-wake).

Waking the coordinator costs a turn with its whole context, so with the
autopilot on and its events left off, it wakes only for these: an agent's
question, a choice after review rounds, a block the engine gave up on, a step
it holds, its schedule and the health check. A task done, ready or started, or
a block the engine fixed itself, wakes nobody. A permission request is yours,
in *Tasks to handle*.

Each kind is its own wake, sent one after the other. Every wake ends with
`wherdr pm ack <id>`, whatever its kind.

**Wakes that would change nothing are not sent:**

- a **scheduled wake** while nothing the coordinator could act on changed since
  its last wake: every task where it stood then, no task it could start now
  (each to-do one waits for its *after* tasks, its files, room or a machine),
  no new block, no answer, no message of yours. It counts in the day's skipped
  wakes, as one with nothing to do;
- an **Engine** wake for a block whose only cause is an offline or paused
  machine: the incident already said so, and the engine goes on once the machine
  is back. It wakes the coordinator only if that resume fails;
- a second wake for an agent's **question** the coordinator already answered
  with `tell`, while the agent's question is still showing;
- a **health check** whose lines are all in the last one sent; it comes again
  after 12 hours at most.

Each one skipped is listed by `wherdr pm autopilot show` (*skippedWakes*: when,
what and why), never in the conversation.

### What a task's agent said

A coordinator reads a task's agent with `wherdr pm read <task>`, on whichever
machine it runs: the last message of its conversation, or the bottom of its
screen when the conversation can't be read. It reads the agent `tell` reaches
(the one that holds the current step, else the worker); `--to worker` or `--to
reviewer` picks one, and `--lines N` (1 to 200, default 40) sets how much. A project's coordinator reads its own project's tasks only.
When an agent asks a question, its task's waiting line and the coordinator's
wake (*question*) carry the question itself, and `wherdr pm tell` answers it.

## Board

The header has **Decisions** (with a count when some wait), **Add task**, the
project picker, a tag filter when tasks have tags, and,
with one project picked, its [Autopilot](#autopilot) button. The picker offers
*Follow machine tab* (the projects the [home tab](home.md#machines-as-tabs) picked
shows; **All** shows every one, and changing the tab updates the board in place),
*All projects*, or one project. Your pick is kept and follows you across devices;
until you pick, it is *Follow machine tab* once machine groups exist, else *All
projects*. The first column is **Your turn**, then the
project's columns, or *To do*, *Working* and *Done* for all projects. A done
or archived task is never under Your turn.

A card shows the task's title, its id (a badge in the project's color: a tap
copies it, *Copied*, without opening the task), the machine it runs on when its
project allows several (*machine-b*), its step, how long it has been in that
step (*12 min in review*) or, once done, how long it took from start to done
(*42 min*), a dot with its agent's state (worker or reviewer), where its PR stands (*PR open · waiting for checks*,
*checks failed*, *merging*, *The PR conflicts with v3*, *merged …*), what you have to do under
Your turn, the tasks it waits for, its first tags and its PR link. A refused
step is said in plain words, never as a command: the commands go to the agent.
When the engine has already asked the agent to bring a conflicting PR up to
date, the card says *The PR conflicts with v3: the agent is updating it* and
leaves Your turn while the PR is still in conflict; once it is not, it is back
under Your turn: *The agent brought the PR up to date with v3*, press again. Its menu (right
click, long press, or ••• when it has more than *Open*) offers:

- **Start**, on a task to do that waits for no other task;
- **Start on…**, on the same tasks of a project that allows other machines than
  its own: pick the machine (offline ones are greyed). Before a task's first
  start on another machine, wherdr checks that machine is ready for the
  project, and refuses the start with what fails there: the clone and its
  origin, `git fetch`, push rights (a dry run), `gh auth status` when the
  workflow uses GitHub, node and npm (against `.nvmrc` or `engines`), the
  clone's dependencies (a warning only: each task then runs `npm ci`), the
  worker's and reviewer's agent CLI and login, the `~/.wherdr/pm` folders, 5 GB
  free disk, and for a task with screenshots, reaching wherdr (set `APP_URL`
  behind a proxy) and Playwright's Chromium. A machine found ready is not
  checked again for 10 minutes; the menu shows the last check's result. A task
  stays on the machine it first started on. The coordinator does the same with
  `task start <task> --on <machine>`;
- **Stop…**, on a running task: its agent ends, the worktree, branch and work
  stay, and nothing is merged;
- **Continue**, **Take it as it is** or **Archive**, on a stopped task;
- **Check on GitHub**, on a task at its merge step or archived with a PR: its
  sheet opens with what wherdr found (see [Task sheet](#task-sheet));
- **Delete…**, on a task never started (no agent, worktree or branch). A task
  other tasks wait for cannot be deleted; its number is never given again.

**Add task** opens a sheet: the project, a title, the task type (with its steps
in one line), its weight, a Markdown description, the tasks it waits for, and
*Start now*. The weight says what the task needs of a machine: *Light* (docs, a
study), *Standard* (tests and typecheck) or *Heavy* (a build, e2e,
screenshots). *Auto* shows what it would be (*Auto: heavy (screenshots)*): the
task type's `weight` when the workflow sets one, else heavy when a worker step
asks for screenshots, light when the type lands no code (no commit, link or git
action), standard otherwise. The coordinator does the same with `task add
--weight`, and `show <task>` gives it.

### Board order

Each column lists its cards in board order: the tasks the coordinator put
first, in the order it gave, then the others, oldest first. Ask the
coordinator (or Alfred) to order them, for example the tasks waiting for a
merge in the order they should merge: it runs `wherdr pm task order <task>
[<task>…]`, which puts these tasks first in their column, in this order, and
leaves the others in their order after them. A done task is refused. The order
is the same for everyone and survives a restart; the project's log says who
ordered what. In a wake, the coordinator orders the board only with the
autopilot on.

Keep the board busy starts to-do tasks in this order, the merge queue takes
approved merges in it when several are ready at once, and `wherdr pm list`
returns tasks in it.

### Spec changes

When you change your mind about a task while it runs, the coordinator records
the change in the task's spec, so the reviewer reviews against what you want
now, not the first description:

- `wherdr pm task edit <task> [--title "<text>"] [--description "<text>"]
  --reason "<one sentence>"` rewrites the title or the description. The
  task's log keeps the reason and a short diff of the old and new text.
- `wherdr pm task note <task> "<text>"` adds a dated spec change under the
  description.
- `wherdr pm tell <task> "<text>" --spec` tells the agent and records the same
  text as a spec change.

The worker's and the reviewer's instructions give the description, then every
spec change, newest last, with the rule *the latest note overrides the
description where they disagree*. A running agent of the task is told at once;
the next ones read it from their step or review round. The task sheet's
Description tab shows the spec changes under the description. The coordinator
makes these changes only in a turn that comes from you, never in a wake.

When a review still fails after several send-backs on findings that
contradict a spec change, the coordinator may pass it, even in a wake and even
when the engine does not offer *pass*: `wherdr pm task decide <task> pass
--reason "<one sentence>"`, the reason citing the spec change (its date,
`YYYY-MM-DD`, or its words). wherdr refuses it when the task has no spec
change or the reason cites none, and then the choice stays yours. It only ends
the review loop: a merge only you may do still waits for you, and a critical
finding with proof stays yours. The pass is
written to the task's log, the coordinator tells you in its next message, and
*Decisions* shows it for a day under *Passed on a spec change*.

### Tasks that touch the same files

Tasks that change the same files do not run at the same time. At the start of
its work, the worker writes the files or folders it plans to change to
`files.txt` beside its instructions file (a folder covers what is in it); the
coordinator can name them ahead with `task add … --files app,docs/board.md`.
Every 5 minutes wherdr reads, for each started task not done yet (running,
waiting for you or for its merge, or stopped), those declared paths and the
files its branch changed (`git diff` since the branch started, new files
included).

When a task starts for the first time (by you, the coordinator or an *after*
chain), and its declared paths overlap what such a task declared or changed, it
stays to do and its card says *Waits for WHR-12, same files*. It starts by
itself once that task is done or no longer touches them. **Start anyway**, on
its card's menu or in its sheet, starts it at once. A task with no declared
paths never waits. A worker that changes files beyond its declared ones adds
them to `files.txt` and says which in its closing note; the task's log notes
them too.

## Task sheet

A card opens the task's sheet. Tasks to handle, Decisions' *Open task* and a task
link in the chat (`#/board?task=ID`) open it over the page you are on (a bottom
sheet on a phone), with `?task=ID` added to that page's address, so it survives a
reload and can be shared; closing it leaves the page as it was. The sheet shows its id badge by the title (a tap copies it) and step, a note when it waits or was
stopped, the time it spent in each step with the time it waited for you apart,
its review rounds and CI fixes (*work 25 min · review 9 min · merge 8 min ·
waited for you 1 h · 2 review rounds · 1 CI fix*), and its buttons (*Start*,
*Open the agent* or *Open the reviewer*, *Stop*, *Delete…*). Step times start
with this version: an older task shows only its total. Below, tabs: **Description** (the text rendered as Markdown, as in the chat but with no raw HTML; tags, links and the PR),
**Plan** (each step with its column, holder, send-backs, instructions, proofs
and screenshots), **History** and **Log**. A refused merge says why under its button.

**History** reads the task as a conversation, oldest first: the worker's *Done*
(its closing report on its last one), the reviewer's *Sent back* (the findings,
with their weight) or *Passed* (what it left as minor), the worker's *Fixed*
(and the findings it contested), wherdr's catch-ups and CI fixes, the
coordinator's and your actions. Each entry says who, when and, for an agent,
its program and model; its text is Markdown, folded past a few lines with
*Show more*. Only the worker's last report is kept, so an earlier *Done* says
just that. **Log** keeps the raw lines, newest first.

At the top of **History**, and of the worker's note in **To do**, a
**Summary** says in 3 to 6 lines how the task went: what was built, the main
review findings and how they were solved, what is left. Claude Haiku writes it
through the `claude` CLI on the wherdr machine (`claude -p`, safe mode, no
tools), from the task's title, the worker's reports and the reviewer's
findings only: no description, no proof, no file contents, and home paths,
e-mail addresses and tokens masked. It is made once per round, again when a
new report or verdict arrives, one task a minute, and skipped while the pace
of this machine's Claude account holds automatic work. A task whose last
report is more than a day old keeps its summary as it is.

**Check on GitHub** shows on a task with a PR at its merge step, or archived:
wherdr reads the PR now, for a merge stuck after a guard refusal, a PR merged
by hand on GitHub, or GitHub slow to see a push. Merged: the merge step ends as
merged and the task goes on (next step or Done), out of Your turn; an archived
task ends as merged. Still open: why it waits (its checks, a review, a branch
only you may merge into), with a link to the PR; a merge wherdr may do is tried
again within a minute. Closed without a merge: said, with **Archive…**. The
coordinator and Alfred run the same check with `wherdr pm task check <task>`
when you ask them to unblock a task.

### A task waiting for you

Open a task under *Your turn* and its sheet starts on **To do**: what the task
needs from you and the buttons for it, before its Description, Plan and Log.

A tap on a card under *Your turn*, or on an entry of the home's **Tasks to
handle**, goes where you act: when the task's agent (worker or reviewer, on any
machine) asks a question or a permission, it opens that agent's conversation,
its question last; anything else opens the sheet on **To do**. The sheet stays
one tap away: *Open the task* in the card's menu, or the small icon at the end
of the entry. An agent that is not on screen here opens the sheet instead.

- **A visual change to merge**: the **Worker's note** (its closing report: what
  was done, why it is done, what was tested) and the **Reviewer's note** (the
  verdict, what it sent back and was fixed during the rounds, what it left as
  minor), each in Markdown, folded to a few lines with *Show more* (the
  task's [summary](#task-sheet) above the worker's note), full
  width, one above the other (on a phone, *Worker* / *Reviewer* tabs above
  one note); then its screenshots large (swipe between them, tap
  one to zoom; each is labelled phone or desktop), then
  *Merge* and *Open the PR*, or *Send back* with a note: the agent gets your note as what to fix.
  A step you end (*Deployed*, …) shows the same two notes under its badge.
  When the agent reworks the task after its review (new commits since the
  review), its new screenshots replace the shown ones, marked *after rework*;
  the earlier set stays in the Plan tab under *Earlier screenshots*. The merge
  step then sends the task back to review, which sees the new set.
- **A review to settle** after several send-backs: each choice the engine offers,
  with what it does.
- **A stopped task**: who stopped it and why, then *Continue*, *Take it as it is*
  or *Archive*, each with what it does.
- **A step that ends with you** (*Done*, or the step's own button): what to do,
  and its button, with *Open the PR* when the task has one.
- **The PR** is any link a step gave as its proof (`evidence: ["link"]`, such as
  a PR the worker opened with its own Bitbucket or GitLab tool) or the one the
  engine's `github.pr` opened. A pull request address from GitHub, Bitbucket,
  GitLab or Azure DevOps is added to the card's links as *PR #12*, and opens
  from *Open the PR* at the merge step, or after a refused merge.
- **A PR to merge on your Git host** (a step you end that checks the merge,
  `git.verify-merged`): wherdr does not merge it, you do. Its badge says
  *Merge the PR on GitHub* (or Bitbucket, GitLab, Azure DevOps, *your Git
  host*, from the PR link), and its button *I merged it* checks that the branch
  is in its target; the step's own badge and button text win. Not merged yet:
  *The PR is not merged into develop yet: merge it on Bitbucket (PR link), then
  press “I merged it” again*.
- **An agent's question or permission**: its text, and a button to open that agent.
- **A refused merge or a blocked task**: the reason in plain words, and what you
  can do (start it, open its agent). A failed action step (a merge GitHub
  refused) has *Try again* at the top of the sheet, which runs it again.

On a phone, the To do buttons (*Merge*, the step's button, *Open the PR*,
*Start*, *Open the agent*) stay pinned at the bottom of the tab while its
content scrolls, so they are always in reach above the home bar.

### Report a problem

Something is wrong with a task waiting for you (the screenshots miss the asked
feature, a part is missing, a bug)? Tap *Report a problem* in its sheet, or in
its card's menu. Say what is wrong, tap the screenshots it is about, and keep
*Block the merge until fixed* on if the merge must wait. It goes to the
project's coordinator (started if it does not run), not to the task's agent,
with the task, its step, your text, the screenshots, the PR and the review: the
coordinator decides whether to tell the agent what to fix, send the step back to
the worker, or add a follow-up task. You never relay it yourself.

The report goes to the task's log, the card says *Problem reported 20:15*, and
the task stays under *Your turn* until the coordinator acts (`wherdr pm report
back` or `report close`), you send the step back, or you *Withdraw* it.

While a merge waits for you, wherdr watches its PR. When the PR starts to
conflict with its base, or falls behind it under a branch rule that wants it up
to date, wherdr merges the base into the branch at once (or asks the task's
agent to resolve the conflicts, starting it again if it was ended). The card
says *updating with* the base and leaves *Your turn* until the PR is clean
again; an agent's conflict resolution gets a short re-review first. One update
runs at a time per task.

Clicking *Merge* is an approval of the task's screenshots that stays: the log
records who approved, when and at which commit. Later updates keep it: the base
merged in, a conflict resolved, red CI fixed. The card shows *Approved, merges
by itself*, and the task sheet *Approved on* its date. Once the PR is clean and
its checks are green, wherdr merges by itself, even on a branch only you may
merge into, and the log says so. The task comes back to *Your turn* (*Look
again, then merge*) only when its agent uploads new screenshots, or when the
task's own changes to interface files (`components`, `assets`, `pages` and
`layouts` folders) differ from those you approved; what a merge of the base
brought does not count.

Until the merge ends, *Merge* stays loading, on the card in *Your turn* and in
the task sheet, with what it waits for under it: its place in the merge queue,
its checks running, an update with its base, or its machine coming back
online. This comes from the approval wherdr keeps, so it is the same after a
reload and on every device. Once merged, the task leaves *Your turn*; if the
merge fails or is refused, *Try again* comes back with the reason in plain
words.

#### The merge queue

Each project has a **merge queue**: every task whose merge may go on without
you (a merge the guards give to wherdr, or one you approved) enters it. Only
PRs ready to merge now stand in line: no conflict, no update required, the
task's last commit on the PR and its checks green. The first in line merges,
then the next one, a minute apart; the tasks the coordinator put first on the
board come first, in [board order](#board-order), then PRs that touch no file
another queued PR touches, then smaller changes.

A PR that needs work steps out of line until it is ready again, so it never
holds up the others: a conflict with its base, checks still running or red,
work handed to its agent, a merge GitHub blocks (a required review) or
refused (that one is yours, under *Your turn*, until a new commit). A ready PR merges as it is, without first being
updated with its base, unless GitHub requires it: wherdr updates a branch only
when GitHub reports a conflict, or reports it behind because the branch rules
want branches up to date. When the base moves, every queued PR that needs an
update gets it in the same pass, and their checks run side by side. An update
that merges cleanly is pushed by wherdr alone; a conflict goes to the task's
agent (started again if it was ended). An update that fails (a network error)
is tried again twice, a few minutes apart. Checks that fail go back to the
agent as red CI, not to you.

A task waiting in the queue with no work handed to its agent lets its agents
go once they are idle for 10 minutes, as for [a task that waits for
you](#agents-of-a-task-that-waits-for-you); wherdr starts the worker again
only if the queue hands it work.

The card shows the place (*2nd in merge queue*) or why the PR stepped out
(*in merge queue, out of line: conflict with its base*); a refused merge in the
queue stays off *Your turn*, and the log says when a task enters the queue and
when it comes first.

### What wherdr fixes on its own

Waking the coordinator costs a turn with its whole context, so wherdr fixes
the mechanical blocks itself and wakes it only when that fails:

- **a PR in conflict with or behind its base**: wherdr merges the base into the
  branch; a conflict goes to the worker (started again if it was let go);
- **red CI**: when the failed job's log shows an infrastructure error (an HTTP
  5xx, a download that timed out, a lost runner), wherdr runs the failed jobs
  again, once; otherwise, or red again after that, the failure goes to the
  worker;
- **a push refused because the branch is behind its remote**: wherdr brings the
  remote's commits into the task's worktree (a fast-forward, else a merge; a
  conflict goes to the worker), then pushes again;
- **an action interrupted** by a restart of wherdr: run again (a merge done
  meanwhile is recorded as merged);
- **a stalled agent** (below): nudged, then restarted once.

These blocks do not wake the coordinator. After 2 failed tries on the same
step (or 15 minutes with nothing left to try), wherdr wakes it once (an
*Engine* wake, whatever the autopilot's events) and says what it tried. Every try, and giving
up, is written to the task's **Log**. Any other failure (a refused merge, a
check that waits for you) goes to *Tasks to handle*, and wakes the coordinator
only when its *Task stuck* event is on.

### A stalled task

A working task is **stalled** when nothing moves: its CI is still red 10 minutes
after wherdr sent the failure to the agent and nothing was pushed, or the agent
holding its step has been idle for 5 minutes without saying it is done. Its card
shows the reason, and wherdr:

- nudges the agent once: the red CI again, with the failing tests read from
  `gh run view --log-failed`, or a reminder to finish its step. Never twice for
  the same cause (the same commit, the same step);
- 10 minutes after the nudge, if it is still stalled: ends the agent and starts
  it again (the worker with the red CI to fix, or the step's holder with its
  step), once;
- 10 minutes after the restart, if it is still stalled: wakes the coordinator
  (*Task stuck*, with the reason and what was tried);
- 30 minutes after the stall began, if it is still there: puts the task under
  *Your turn* and in the sidebar's **Tasks to handle**, with the reason, and
  sends a notification (it needs the *Needs you* level).

The task's **Log** lists each of these: the stall, the nudge, the restart, the
hand-over to you and the notification.

A step that runs past its time limit (*Check work: over 3h*, *Check review:
over 45m*) or a stall leaves *Your turn* and **Tasks to handle** once the task
is back to work: the coordinator tells its agent something (`wherdr pm tell`),
you or the coordinator start it again, or the step's agent, idle, is seen
working again. The step's time limit and the stall's 30 minutes start again
from then, so the task comes back if its agent stops again. The Log says
*back to work* and who sent it back. What only you can do (a merge, an answer,
a permission, a decision) stays until you do it.

### Why agents are gone

When a task's agents are gone (after a restart, or while wherdr runs), the
engine decides the cause from facts it reads, never a guess:

- **machine offline or unreachable**: its herdr-core does not answer;
- **herdr-core or wherdr restarted** (or the machine rebooted): every agent's
  terminal of a machine gone at once (none still running there), herdr-core
  started after the agents, or
  herdr-core ended them itself (a stop, a restart, the host shutting down);
- **agent killed or crashed**: its terminal ended with an exit code or a
  signal; **out of memory** when its last output says so;
- **account limit reached**: only when the account's reading at that time
  says it was at its limit ([Quotas](quotas.md));
- **unknown**, said as such, when the facts do not decide (an agent that
  exited with 0, a terminal missing on a core older than it).

Each one is recorded as an **incident**, per machine: when, the cause, the
facts used, the tasks and agents hit. The task waits with the cause (*The
agent's terminal is gone: …*), after a restart as while wherdr runs, and its
Log names the incident; wherdr then resumes it by itself
([The engine resumes the work](#the-engine-resumes-the-work)). An incident is open until its tasks run again (started
again, a new agent): what they wait for later is not this incident.

The coordinator lists them with `wherdr pm incidents [--since 2h|3d|<date>]`
(the last 7 days by default), and `wherdr pm autopilot show` gives the last
open one, so it tells you the cause the engine found.

### The engine resumes the work

A task an incident stopped waits for wherdr, not for you: it is not in Your
turn, the coordinator sees it as working (never stuck, nor waiting for you in
its health check), its card says why it waits (*… wherdr resumes it once host-b is back*).
Once the cause is gone, the engine resumes it by itself, every minute:

- **when**: a restart, a crash or an unknown cause at once; a machine offline
  once it is back (still offline, its tasks keep waiting); an account limit
  once the account's reading says it reset;
- **how**: its worker starts again in its worktree. A Claude worker takes its
  conversation up again (`--resume`, its session id kept from its start) with
  *You were interrupted (…): check git status and continue*; Codex, or a
  conversation that cannot be resumed, gets a new agent that reads its
  instructions with a handover note saying the same. A task stopped at the
  review gets its reviewer again;
- **in order**: the tasks before it (`after`) first. A task that starts after
  one being resumed stays to do and *Waits for WEB-1 to resume*, never
  *stopped*; it starts once that one is done;
- **within the rules**: on its own machine when that machine has room and its
  account's pace lets it ([Machines](machines.md#manage-machines)), one start per machine and
  minute, never a second worker on the task;
- **once in a row**: stopped again for the same cause within an hour of the
  engine's resume, it is not resumed again: the incident's wake says so, and
  the task waits in Your turn until it is started again.

Its Log says *resumed after incident …*, and a stall or a step past its time
limit from the outage leaves Tasks to handle once the task works again.

### The incident wake

Once the engine's resumes after an incident are done (none still under way),
the coordinators get **one wake per incident**, never one per task, headed
*Incident: <incident>, wake <id>*, even with the autopilot off. It gives the
engine's facts:

- the cause and the evidence it read (machine, times, exit codes, the
  account's reading);
- **Resumed**: the tasks working again;
- **Still waits**: those the engine resumes by itself, and why (*host-b still
  offline*, *the account's limit until <time>*, *waits for WEB-1 to resume
  first*, no room on the machine);
- **Needs you**: a task stopped again right after its resume, for the
  coordinator to start once the cause is fixed;
- **Needs the user**: a permission, a question, a sign-in, a merge or another
  Your turn.

Each project's coordinator gets its own tasks; the main coordinator (Alfred)
gets every project's, so he can say what happened for all of them. Both
follow one rule: **never state a cause they did not read**. Before explaining
a stop they run `wherdr pm incidents`, `wherdr pm autopilot show` and
`wherdr pm read <task>`; when those facts do not decide, they say the cause is
unknown and what they checked.

### A task's temporary files

A task's worker and reviewer keep their temporary files in the task's
worktree, in `.wherdr-tmp` (`~/.wherdr/pm/worktrees/<task>/.wherdr-tmp`), not
in the machine's `/tmp`, which is often small and shared by every agent:
wherdr sets `TMPDIR`, `CLAUDE_CODE_TMPDIR` and `NODE_COMPILE_CACHE` to it for
Claude Code and Codex alike. git ignores the folder (through the repository's
`.git/info/exclude`), so it is never committed and never keeps a worktree from
being removed. It goes with the worktree when the task ends (done, archived);
it stays when wherdr ends idle agents, for the ones started again later.

Before it starts an agent, wherdr checks the machine's `/tmp`: with less than
500 MB free, the agent is not started and the task waits with the reason
(free some space, then start it again).

### Processes an agent leaves behind

When wherdr ends an agent (the task is done, stopped, released or restarted),
it ends every process the agent started, not only its terminal: the
terminal's process tree and each process group in it (a test runner's shells
keep their group even once re-parented), with TERM, then KILL after 3 seconds,
on Linux and macOS alike.

At start and every 5 minutes, wherdr also looks on each machine for the
processes an agent started that are still there while their task has no live
agent, or no longer exists. It knows them by the temporary folder they
inherited from the agent (`CLAUDE_CODE_TMPDIR`, set to the task's
`.wherdr-tmp`), wherever they run, never by their folder alone. macOS hides
that from its own programs (`sh`, `zsh`, `sleep`): those go with the marked
process they run under or share a process group with, or, once re-parented to
`launchd` with their folder in that task's worktree, on their own. It kills
them and says so in the task's log (*killed 7 leftover processes, 6 h old*). Your
own shell, editor, apps and daemons are never touched, even when they run in a
worktree, nor the processes of a task whose agent runs. The machine's line in
Settings › Machines then says *n leftover processes killed*
(since wherdr started).

The wherdr template tells its workers to run a test command that could hang
with a timeout (`timeout 600 …`) and to leave no background job running when
they report done.

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

The same goes when you answer and the task moves on: a review decision (*pass*,
say), *Send back*, *Try again* or a merge you confirm hands the next step to
its worker or reviewer, which wherdr starts again at once. As a safety net,
wherdr also watches every task under way: when the agent that holds its
current step has not been running for 3 minutes (released, ended on its own,
or gone in a wherdr restart), wherdr starts it again in its worktree, with a
note on where the work stands, and the log says so. When it cannot, the card's
status says why (*Waits for its machine (offline)*, *Waits for its machine
(paused)*, no room on the machine), wherdr tries again every 3 minutes, and at
the second failure the project's coordinator is woken once (its autopilot on).
A start wherdr refuses (the agent's program missing, say) puts the task in
*Your turn* with the reason.

When wherdr hands the worker work of its own (a catch-up with the base branch,
a CI fix), the task leaves *Your turn* and its card says *the agent is
updating the PR*: its agents are never ended while wherdr waits for that work.
The task is yours again once the worker pushes or says it is done. If the
worker has ended when wherdr hands it that work, or ends before it pushes,
wherdr starts it again in its worktree with the same message, once. When it
cannot (its machine is offline, paused for the project or has no room, or the
worker ended again), the card says why it waits instead, for example *Waits
for its machine (offline)*, *Waits for its machine (paused)* or *Waits for its agent: it ended. The coordinator, or Stop then Resume,
continues it*, and the project's coordinator is woken once with that reason
(its autopilot on); with no coordinator to wake, the task goes to *Your turn*.
Once the machine is back (online, or switched on again), wherdr starts the worker again by itself. Before it
ends a task's agents, wherdr pushes the commits the branch has not pushed yet;
if the push fails, the agents stay and the log says why.

A task has one worker and one reviewer at most. Two starts at the same time
(yours, the coordinator's, the engine's when the task before it is done, a
start held for room) start one agent: the other is refused as *already
starting*, and a start held for room is dropped once the task started another
way. A task whose worker still runs (waiting for your answer, say) is not
started again: stop it first. Should two agents of one role ever run on a
task, wherdr keeps the one it tracks, ends the other and says so in the log.

A message from the coordinator (`wherdr pm tell <task>`) goes to the agent
that holds the task's current step; at a step held by nobody (the PR, the
merge, a step you end) it goes to the worker, started again if it was ended.
The coordinator can pick one with `--to worker` or `--to reviewer`, and its
answer says which agent got the message.

In a wake, the coordinator may tell an agent something only to answer its
question, or, with the autopilot on, to unblock a mechanical block of a task of
its project: `wherdr pm tell <task> "<what to do>" --fix <kind> --reason "<one
sentence>"`, where the kind is `base` (merge the base and solve a conflict),
`ci` (fix a red CI), `machine` (retry after a disk or memory problem) or
`stall` (restart a stalled agent). A worker that was let go or ended on its
own starts again with the message; a stopped or finished task is never fixed. Each fix is written to the task's log with its reason, at most
twice per task and step; after that the block is yours, and the coordinator
tells you. Each wake's text lists these fixes. A permission request, a merge,
an approval, guards, settings and limits stay yours.

A step whose action failed (a push refused, a PR not opened) and that the
coordinator, or you, hand to the worker with `--fix` leaves *Your turn* and
**Tasks to handle** while the worker fixes it: the card says *the agent is
fixing it*, with no **Try again** in the middle of the fix, and the
message asks the worker to say when it is done. A failed action
wherdr hands the worker on its own (a catch-up, a CI fix) works the same way.
Once the worker says it is done (or pushes, for wherdr's own hand-off), wherdr
tries the action again itself. If that fails again, or the worker stops for 3
minutes, or ends, without saying it is done, the task is back in **Tasks to
handle** with the new reason. The Log says each of these.

A machine's cap of agents (Settings › Machines) counts only the agents working
on a step: not those of a task that waits for you, and not the coordinators.
Its free-memory threshold still holds automatic starts.
