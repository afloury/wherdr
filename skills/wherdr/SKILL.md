---
name: wherdr
description: Conventions for coordinating a herdr-projects project whose TASKS.md is shown and driven by wherdr's Project panel. Use when you coordinate a herdr-projects project (you edit TASKS.md, launch and merge threads), and whenever a message starts with "✓ Tested:", "✓ Testé :", "✗ Problem:", "✗ Problème :", "? Question:", "? Question :", "↳ Decision:", "↳ Décision :", "↳ Launch", "↳ Lancer", "↳ Move up", "↳ Monter", "↳ Move down", "↳ Descendre", "↳ Queue:", "↳ Mettre en file", "↳ Remove from queue", "↳ Retirer de la file", "↳ Back to backlog", "↳ Remettre au backlog", "↳ Unblock", "↳ Débloquer", "↳ Detail on", "↳ Précision sur", "✓ Reviewed:", "✓ Relu :", "↳ Feedback on", "↳ Retour sur", "↳ Info for" or "↳ Info pour".
---

# wherdr Project panel conventions

wherdr shows the project's `TASKS.md` as a board on the user's phone and computer, with
buttons on each task. Each button sends a short message to you, the coordinator. You own
`TASKS.md`: the panel never edits it, it only reads it and asks you to.

Follow the project's own instructions (`PROJECT.md`) first; this skill fills in what the
panel expects. Write task lines and badges in the user's language.

## TASKS.md format

```markdown
## To test
- [ ] Swipe between panes on the phone [b:green(ready to test)] [b:gray(t-0042)](t-0042)

## In progress
- [ ] Fix the quota shown for Codex [b:red(bug)] (agent → t-0043)

## In queue
- [ ] Dark mode for the settings

## Backlog
- [ ] Export a conversation as Markdown
```

- Each `## Title` is a list; each `- [ ] text` (or `- text`) line under it is a task.
  `- [x]` marks it done. `#` headings, `###` subheadings, indented lines (task details) and
  fenced code blocks are ignored.
- The last `(…)` of a line is the owner (`me`, `agent`, a name, `agent → t-NNNN`): read,
  never shown.
- Lists are shown in a fixed order (the order below), whatever their order in the file.
  Unknown titles are shown after Backlog, without buttons. Only lists present in the file
  are shown (plus In progress when threads are open, and Done). Add or remove a list only
  when the user asks.

## Lists the panel recognizes

Titles are matched case- and accent-insensitively; any of these names works.

| List | Accepted titles | Meaning | Buttons |
|---|---|---|---|
| To test | À tester, To test, Testing, To verify, À vérifier, Test | Deployed, ready for the user to check. | Confirm, Problem, Question |
| To decide | À décider, To decide, Decision(s), Decide, Question(s) | Questions only the user can settle. | Question, Answer |
| To review | À relire, Relire, Relecture, To review, Review(s), Code review, PR(s), Pull request(s), À valider, To validate | Pull requests for the user to review; put the PR link in a badge or in the text. | Reviewed, Comment |
| In progress | En cours, In progress, Doing, Ongoing, WIP, Active | Only what a thread is really doing now. Open threads are shown here live. | Add info (on a thread) |
| In queue | En file, En file d'attente, File d'attente, File, In queue, Queue, Queued, Up next | Decided work: launch the first task as soon as a thread slot frees, in list order. | Up, Down, Launch now, Clarify, Remove from queue |
| Blocked | Bloqué(e)(s), Blocked, On hold, En attente, Waiting, Stuck | Waiting for something external. Optional reason: `— blocked by: <reason>` (`— bloqué par : …`). | Unblock, Clarify |
| To do | À faire, Todo, To do, To dos, Todos, Next, Prochainement, Soon | Soon, in the user's priority order. Never launched without a request. | Up, Down, Queue, Launch now, Clarify, Back to backlog |
| Backlog | Backlog, Later, Plus tard, Idées, Ideas, Someday, Un jour | Everything else. Never launched without a request. | Launch, Clarify |
| Done | Fait(s), Done, Terminé(e)(s), Finished, Complete(d) | Filled by the panel with resolved threads; you may leave it out. | — |

Rules:

- **To test** holds only what is deployed and ready. Work being fixed goes back to In
  progress; waiting work goes to In queue.
- **No duplicates across lists.** When the user asks for a change to a feature that is in
  To test, remove its To test line; one line comes back to To test once the change is
  deployed (feature and change tested together).
- **In queue** contract: whenever a thread slot frees (a thread is resolved), launch the
  first In queue task and move it to In progress, as long as the project and the machine
  have a free slot. The In queue header shows the thread slots in use
  (`max_parallel_threads` of `PROJECT.md`).

## Global thread limit per machine

The user can set a maximum of threads per machine, across all projects, in wherdr
(Settings › Plugins › herdr-projects). wherdr then writes `.wherdr-limits.json` in the
herdr-projects folder (the parent of the project folder):

```json
{ "updated": "…", "this": "Server", "machines": { "Server": { "max": 2, "open": 2, "free": 0, "threads": ["shop/t-0012"] } } }
```

Before starting a thread, read `machines[this].free` (or `machines["<machine>"]` for a
thread on another machine; `max: null` means no global limit). When `free` is `0`, wait,
even if the project still has slots. File missing or out of date: count the open threads of
every project with `herdr-projects overview`. Go beyond a limit only when the user says so.

## `(agent → t-NNNN)`

Write an In progress task handled by an open thread with the owner `(agent → t-NNNN)`
(the arrow may also be `->`). The panel hides that line while the thread's own live card is
shown, so the task does not appear twice. Write the thread ID exactly (`t-` and at least
four digits).

## Badges

The only decoration the panel draws. Anywhere on a task line:

- `[b:color(text)]`: a badge. `[b:(text)]` is neutral.
- `[b:color(text)](target)`: a clickable badge. Target: an `https://` (or `http://`) URL, or
  a thread ID (`t-0042`, opens that thread's tab). Anything else is not clickable.
- Colors: `red`, `orange`, `amber`, `green`, `teal`, `blue`, `violet`, `pink`, `gray`
  (`grey`), a hex color (`#e5484d`, `#fff`), or nothing (neutral).
- Text: short, at most 24 characters. It is removed from the task text (the text the
  panel sends back to you).

Use them sparingly, when they help the user: two or three per line at most. Defaults
unless the user prefers otherwise:

- `[b:gray(t-0042)](t-0042)`: the thread a line comes from.
- `[b:green(ready to test)]`: every To test line.
- `[b:amber(fixing)]` (with the thread badge) on In progress work being fixed;
  `[b:gray(queued)]` on waiting work.
- `[b:red(bug)]`: a fix. `[b:blue(iPhone)]`: to test on the phone.
- A PR: `[b:violet(PR #12)](https://github.com/<owner>/<repo>/pull/12)`.

## Messages from the panel

`<task>` is the task text as the panel shows it: the line without its checkbox, badges and
owner. Find the line in `TASKS.md` by that text. The English or French form depends on the
app language; treat them the same.

Messages marked *sent* arrive as is. Messages marked *draft* are put in the user's input
field, completed by the user after ` — `, then sent: read the user's text after the dash.
`↳ Info for` names a thread (`t-NNNN`) instead of a task; its text may span several lines.

| Message (EN / FR) | From | What to do |
|---|---|---|
| `✓ Tested: <task>` / `✓ Testé : <task>` (sent) | To test › Confirm | The user validated it: remove the line from To test. |
| `✗ Problem: <task> — <details>` / `✗ Problème : <task> — …` (draft) | To test › Problem | A bug report: remove the line from To test, fix it (or launch a thread) and track it in In progress; it comes back to To test once the fix is deployed. |
| `? Question: <task> — <question>` / `? Question : <task> — …` (draft) | To test, To decide › Question | Answer in detail: what to test and how (where to tap, expected result), from the thread's report. Do not change `TASKS.md`. |
| `↳ Decision: <task> — <answer>` / `↳ Décision : <task> — …` (draft) | To decide › Answer | Apply the decision, remove the line from To decide, and record it where the project keeps durable decisions. |
| `✓ Reviewed: <task>` / `✓ Relu : <task>` (sent) | To review › Reviewed | The user reviewed the PR: carry on (merge, deploy as the project says) and remove the line from To review. |
| `↳ Feedback on <task>: <comments>` / `↳ Retour sur <task> : …` (draft) | To review › Comment | Review feedback on that PR: apply it or send it to the thread. |
| `↳ Move up: <task>` / `↳ Monter : <task>` (sent) | To do, In queue | Move the line one place up in its list. May arrive several times in a row. |
| `↳ Move down: <task>` / `↳ Descendre : <task>` (sent) | To do, In queue | Move the line one place down in its list. |
| `↳ Queue: <task>` / `↳ Mettre en file : <task>` (sent) | To do › Queue | Move the line from To do to the end of In queue; launch it if a slot is free and it is first. |
| `↳ Launch now: <task>` / `↳ Lancer maintenant : <task>` (sent) | To do, In queue › Launch now | Launch a thread now if the project and the machine have a free slot (beyond the limits only if the user says so); otherwise put the line first in In queue. |
| `↳ Remove from queue: <task>` / `↳ Retirer de la file : <task>` (sent) | In queue | Move the line back to the top of To do. |
| `↳ Back to backlog: <task>` / `↳ Remettre au backlog : <task>` (sent) | To do | Move the line to Backlog. |
| `↳ Launch: <task>` / `↳ Lancer : <task>` (sent) | Backlog › Launch | Start the task: a thread if a slot is free, otherwise first in In queue. |
| `↳ Unblock: <task>` / `↳ Débloquer : <task>` (sent) | Blocked › Unblock | Relaunch the task, or ask the user exactly what is still missing. |
| `↳ Detail on <task> — <details>` / `↳ Précision sur <task> — …` (draft) | Clarify (Backlog, To do, In queue, Blocked) | Add the details to the task (indented lines under it, or the thread's brief) and confirm. Do not launch it. |
| `↳ Info for t-NNNN: <text>` / `↳ Info pour t-NNNN : <text>` (sent) | In progress › Add info (a thread's card, or the task of a thread) | Pass `<text>` on to that thread as is, every line of it, without rewording (`herdr-projects thread prompt <project> t-NNNN --text-file <file>`, `-` reads standard input), then confirm to the user in one line. Do not change `TASKS.md`. If the thread is resolved or unknown, say so instead. |

Never launch a task from To do or Backlog without one of these requests.

## After a deployment

For each change the user can now see, add one To test line written from the user's point
of view: what to open and what should happen, not the technical cause ("Swipe between
panes on the phone", not "Fix pointer events in PaneSwiper"). Add
`[b:green(ready to test)]` and the thread badge. Remove the matching In progress line.

Name threads and tasks the same way: what the user sees.

## Questions left unanswered

A question you asked the user that is still open goes to To decide, so the user can answer
it from the panel. Remove the line as soon as it is answered.
