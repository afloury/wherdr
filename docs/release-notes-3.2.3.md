## Improved
wherdr 3.2.3 makes sending and answering dependable: a message is never sent twice or lost, an agent's prompt can be answered from the conversation while it is pending, and **Tasks to review** shows an agent's question or permission only when you are needed. It also brings tickable checklists, copy on select, snooze and dismiss in Tasks to review, named agents and per-program models, a ⌘K palette, Private notifications, and many terminal, omp and Antigravity fixes. Thanks to [@followcat](https://github.com/followcat) and [@simonsmallchua](https://github.com/simonsmallchua) for a large share of this release. Update as usual: the banner's *Update with Alfred*, or `update.sh 3.2.3` in the install folder.

## Fixed

**Messages are never sent twice or lost.** After a multi-line message, a failed extra Enter no longer offers to type the text again. The first message to a new agent waits through a failed screen read instead of being dropped. A *Not sent* message survives a page reload, and one that was still sending comes back into the field for you to check. (#1100)

**Answering a pending prompt.** A permission or question card in the conversation is now tied to the agent's pending tool call and shows its full command, so a tap works while the prompt is asked, even with Claude's countdown running or after a resize, and two similar parallel calls are never mixed up. (#1107)

**The interactive terminal window stays put.** In the conversation view it no longer opens and closes by itself; it opens watch-only, keeping the pane's size, until you press a key or tap. (#1108)

**Tasks to review only when you are needed.** An agent's question or permission leaves Tasks to review within seconds of being answered. A permission shows once it has lasted 20 seconds, and a question the coordinator is handling under autopilot once it has gone 3 minutes unanswered. (#1105)

**Your stop always wins.** The engine never overwrites a stop, an answer or an archive you made while it was working on the task. (#1101)

**Muted means muted.** A muted coordinator's projects are left out of every push, the grouped decisions included. (#1102)

**And more.** Queued messages show in sending order, long or photo messages always reach Claude, an idle server stays idle with hundreds of tasks, a step's clock pauses while it waits for your answer, `mergeAfter` holds every kind of merge, a task whose start failed can be deleted or started again, and Antigravity, Hermes and terminal rendering got many fixes from [@followcat](https://github.com/followcat).

## New

**Tickable checklists.** The `- [ ]` items of an agent's reply are checkboxes; ticks never wake the agent and follow you across devices. Thanks to [@simonsmallchua](https://github.com/simonsmallchua). (#1084)

**Copy on select.** Selecting text with the mouse in a conversation or the terminal copies it at once (on by default on a computer). Thanks to [@simonsmallchua](https://github.com/simonsmallchua). (#1082)

**Snooze or dismiss in Tasks to review.** Put an item away for an hour, until tomorrow, or until something new happens on its task. Thanks to [@simonsmallchua](https://github.com/simonsmallchua). (#1056)

**Named agents and per-program models.** Give a command (a wrapper script and its options) a name per machine, choose the agent per task with `task add --agent`, and let a workflow set a model per program so the model follows the agent. (#986, #987, #1098)

**One palette for everything.** ⌘K / Ctrl+K searches conversations, tasks, projects, settings and actions in one place. (#1015)

**Private notifications.** A new switch in *Settings › Notifications* makes every push one generic line, so nothing private shows on a lock screen. (#1102)

**For plugins and agents.** Plugins can add header widgets and prepare a draft, and the host cleans up what a plugin registered when it stops. Command Code conversations open on Linux, the `/` list offers omp's and Claude Code's commands and skills, and a worker that needs you for a login or a payment can push you directly. Thanks to [@followcat](https://github.com/followcat) and [@simonsmallchua](https://github.com/simonsmallchua).

## Improved

**On the phone.** *Stop* no longer appears under your finger right after *Send*, and *Enable notifications* comes first while the device has none. Sheets drag like drawers. (#1103, #1018)

**Clearer screens.** Attachments are tiles in the message field and in sent messages, the task sheet's header shows what matters first, History is a timeline, a shown file reads like a clean document, short settings are segmented buttons, the folder picker is a tree, and Pace has a weekly quota chart per account.

[Full changelog](https://github.com/afloury/wherdr/blob/v3.2.3/CHANGELOG.md)

Join us on Discord: https://discord.gg/ky36WYmtVE
