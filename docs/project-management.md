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
  old ones too, shows the new key; links and commands with a former key still work.
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
  optional model (empty: the agent's default).
- **Repository**: public or private, as wherdr found it (*Check again*) or as
  you set it. A public repository gets the coordinator's public-repository rules.
- **Based on**: the template the workflow was copied from and its version, for
  information only: a later change to the template, or its deletion, does not
  reach the project.
- **Machines**: the machines its tasks may run on. The first is the project's
  own (*Home*, its folder), read only. *Add a machine* picks one of the connected
  machines and takes the path of the repository's clone there (`~/project`); once
  saved, wherdr runs that machine's readiness check (see *Start on…* under
  [Board](#board)) and shows *Ready* or what is missing. ✕ removes a machine:
  new tasks no longer start there, tasks already there stay. Alfred does the
  same with `wherdr alfred project machine add|remove` ([Alfred](alfred.md)).
  **Placement** chooses how new tasks spread over these machines: *Heavy to the
  strongest* (the default: light and standard work at home when it fits, heavy
  work on the machine with most room), *Balance the load* (each task on the
  machine with the largest share of memory and cores left after it) or *Home
  first* (other machines only once home is full). A machine fits a task when
  its free memory covers the task's estimate plus the machine's reserve
  (Settings › Machines). A task that waits for room names it, and so does the
  coordinator's `autopilot show`. A task too big for every machine it may use
  (their RAM less the reserve is under its estimate) runs on the best one
  instead of waiting forever, and its log says so once. A worker started
  again in its worktree (a catch-up, red CI, a send-back, the step it is woken
  for) is weighed by what it does, not by its type: heavy only while its step
  still lacks its screenshots, standard otherwise.

### Workflow

The project's own workflow: its task types, and the steps of each. Each step
has an id, a column on the board, who holds it (worker, reviewer, coordinator
or none), how it ends (a report, a verdict, you, or an action) and, for an
action, what it does: land on a branch, push, open a PR, merge a PR, or check
that a branch was merged, with its branch, merge method and required checks.
A merge that first pushes the task's last commits waits up to a minute for
GitHub to show them on the PR.
In JSON, a task type may set `weight` (`light`, `standard` or `heavy`, see
*Add task* under [Board](#board)). Under the form, the plan of the chosen task type. *Save* checks the workflow
and shows each problem with its line.

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
review says so: ask the coordinator to propose again. The coordinator's window
and the *Decisions* view link to this review.

In the coordinator's conversation, a card follows the message that made the
proposal: what changes in one line, who proposed it, your request with its
time and *Go to message* (back to it in the conversation), *Accept*, *Refuse*
and *See all changes* (the review). Once answered, the card shows the outcome, by whom and
when.

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

The project coordinator's [autopilot](#autopilot), as in its window, and a link
to the [pace](quotas.md#pace) of every account.

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
project coordinator's conversation, the **Autopilot** button in the header shows the autopilot's state (green square: on; hollow: asleep) and a
count of what waits for you: a workflow change the coordinator proposed, or a
kept conversation that ran with another agent. A tap opens its window:

- the agent that answers the coordinator (Alfred's too), and a warning when its conversation
  ran with another one: *New conversation* with the default, or *Resume* the one kept (for
  Alfred, the agent resumed becomes its default); on the board, *Open* opens or starts it; when its
  conversation stopped (its terminal ended, for example when its machine
  restarted), *Resume the conversation* takes it up again with the agent that
  ran it, and *New conversation* starts a new one;
- the proposed workflow change: *Review* opens it in the project's [Workflow](#workflow) tab;
- the autopilot: a switch, a **goal**, how often it wakes (*Every*, *At*), its
  limits (*Tasks / day*: up to 1000, empty for no daily limit; *At once*: empty is *Auto*, as many as the project's
  machines have room for; both empty for a new project, while a project that
  kept the older defaults (10 a day, 2 at once) keeps them, with the hint *Older
  defaults: clear the fields for unlimited and Auto*; a task whose step
  holds no agent, such as a PR or merge waiting for checks or the queue, or a
  step of yours, takes no slot), the events it wakes on (*Task added*: by someone else than this
  coordinator, such as you, another coordinator or an automation; *Task
  done*, *Task stuck*, *Ready for you*) and *Look for new work* (scheduled wakes
  even with nothing to do, with its own *New tasks / day*). The form says
  *Unsaved changes* until you save;
- its wakes, each created, delivered and acknowledged, and *Run now*.

Automatic work (the autopilot, automations) waits while an account is ahead of
its [pace](quotas.md#pace) (a machine whose account waits is skipped) or no
machine the project allows has room for the task
([Machines](machines.md#manage-machines)), whatever the task counts; your own
starts never wait.

The coordinator sees the same with `wherdr pm autopilot show`: the project's
placement strategy, one line per machine the project allows (memory, cores and load, its agents at work by
weight, and the heaviest weight it takes now, or why none: full, not ready,
paced, offline), and what each weight counts (*light* ≈ 0.7 GB, *standard* ≈
1.8 GB, *heavy* ≈ 3.9 GB) with the weight of each task type. `show <task>`
gives the machine a started task runs on. Its instructions say the engine
places tasks, `task start --on` picks a machine and `task add --weight` sets a
weight that differs from the task type's.

### What a task's agent said

A coordinator reads a task's agent with `wherdr pm read <task>`, on whichever
machine it runs: the last message of its conversation, or the bottom of its
screen when the conversation can't be read. It reads the agent `tell` reaches
(the one that holds the current step, else the worker); `--to worker` or `--to
reviewer` picks one, and `--lines N` (1 to 200, default 40) sets how much. A project's coordinator reads its own project's tasks only.
When an agent asks a question, its task's waiting line and the coordinator's
*Task stuck* wake carry the question itself, and `wherdr pm tell` answers it.

## Board

The header has **Decisions** (with a count when some wait), **Add task**, the
project picker (*All projects* or one), a tag filter when tasks have tags, and,
with one project picked, its [Autopilot](#autopilot) button. The first column is **Your turn**, then the
project's columns, or *To do*, *Working* and *Done* for all projects. A done
or archived task is never under Your turn.

A card shows the task's title, its id (a badge in the project's color: a tap
copies it, *Copied*, without opening the task) and step, how long it has been in that
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

## Task sheet

A card opens the task's sheet: its id badge by the title (a tap copies it) and step, a note when it waits or was
stopped, the time it spent in each step with the time it waited for you apart,
its review rounds and CI fixes (*work 25 min · review 9 min · merge 8 min ·
waited for you 1 h · 2 review rounds · 1 CI fix*), and its buttons (*Start*,
*Open the agent* or *Open the reviewer*, *Stop*, *Delete…*). Step times start
with this version: an older task shows only its total. Below, tabs: **Description** (the text rendered as Markdown, as in the chat but with no raw HTML; tags, links and the PR),
**Plan** (each step with its column, holder, send-backs, instructions, proofs
and screenshots) and **Log**. A refused merge says why under its button.

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

- **A visual change to merge**: its screenshots large (swipe between them, tap
  one to zoom; each is labelled phone or desktop), the review's verdict, then
  *Merge* and *Open the PR*, or *Send back* with a note: the agent gets your note as what to fix.
  When the agent reworks the task after its review (new commits since the
  review), its new screenshots replace the shown ones, marked *after rework*;
  the earlier set stays in the Plan tab under *Earlier screenshots*. The merge
  step then sends the task back to review, which sees the new set.
- **A review to settle** after several send-backs: each choice the engine offers,
  with what it does.
- **A stopped task**: who stopped it and why, then *Continue*, *Take it as it is*
  or *Archive*, each with what it does.
- **A step that ends with you** (*Merged*, or the step's own button): what to do,
  and its button, with *Open the PR* when the task has one.
- **The PR** is any link a step gave as its proof (`evidence: ["link"]`, such as
  a PR the worker opened with its own Bitbucket or GitLab tool) or the one the
  engine's `github.pr` opened. A pull request address from GitHub, Bitbucket,
  GitLab or Azure DevOps is added to the card's links as *PR #12*, and opens
  from *Open the PR* at the merge step, or after a refused merge.
- **An agent's question or permission**: its text, and a button to open that agent.
- **A refused merge or a blocked task**: the reason in plain words, and what you
  can do (start it, open its agent). A failed action step (a merge GitHub
  refused) has *Try again* at the top of the sheet, which runs it again.

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

#### The merge queue

Each project has a **merge queue**: every task whose merge may go on without
you (a merge the guards give to wherdr, or one you approved) enters it, and
wherdr merges them one at a time. The first in the queue is updated with its
base: wherdr merges the base into the branch and pushes it when that merges
cleanly, even when GitHub does not flag the branch as behind; on a conflict it
hands the conflicting files to the task's agent (started again if it was
ended), and the task keeps its place. An update that fails (a network error)
is tried again twice, a few minutes apart; past that, the task goes to the end
of the queue so the others go on. wherdr then waits for the required
checks on the updated PR and merges it, and the next task comes up. Checks that
fail after an update go back to the agent as red CI, not to you, and that task
goes to the end of the queue meanwhile. The others wait their turn and are not
updated before it: PRs that touch no file another queued PR touches come first,
then smaller changes. A PR already ready when it reaches its merge step merges
at once. The card shows the place (*2nd in merge queue*), a refused merge
waiting its turn stays off *Your turn*, and the log says when a task enters
the queue and when it comes first.

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
step (or 15 minutes with nothing left to try), wherdr wakes it once, as the
autopilot's *Task stuck* event, and says what it tried. Every try, and giving
up, is written to the task's **Log**. Any other failure (a refused merge, a
check that waits for you) wakes the coordinator at once, as before.

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

When wherdr hands the worker work of its own (a catch-up with the base branch,
a CI fix), the task leaves *Your turn* and its card says *the agent is
updating the PR*: its agents are never ended while wherdr waits for that work.
The task is yours again once the worker pushes or says it is done. Before it
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
