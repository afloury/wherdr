---
name: wherdr
description: How wherdr, the phone and browser app for Herdr, shows a herdr-projects 1.x board and what reaches you from it. Use when you are the herdr-projects Coordinator or a task's agent and a message may come from wherdr's Board.
---

# wherdr and herdr-projects

wherdr shows the user's Herdr agents on their phone and computer. Its **Board** shows the
herdr-projects work board (1.2.1 or later) of every machine, in the board's own five groups:
needs you, ready to approve, working, to do, done. wherdr reads the board through the
herdr-projects command line (`list --json`, `details <id> --json`); it never edits the
board's files.

## What reaches you from the Board

wherdr adds no message format of its own. What the user does on the Board goes through the
ordinary herdr-projects commands, as if typed on the machine:

| On the Board | Command wherdr runs | Who gets it |
|---|---|---|
| The Coordinator box | `herdr-projects coordinator tell <text>` | the Coordinator |
| Reply, on a task | `herdr-projects tell <id> <text>` | that task's agent (on a plan that waits: the plan goes back with the text) |
| Approve, on a task | `herdr-projects approve <id>` | the board: it merges, or says yes to the plan |

(`herdr-projects` stands for the launcher the board hands you by its full path,
`~/.herdr-projects/data/bin/herdr-projects`: 1.x puts nothing on the PATH.)

So a message from the Board is the user's own words: answer and act on it as on any message
from them. Report your progress with `herdr-projects report` as usual: the Board shows the
state, the message and the progress you report, the pull request and the review.

## What the Board does not do

No task is added, delegated, stopped, archived or cleared from wherdr: the user asks the
Coordinator for that, in the Coordinator box. Settings and automations stay in the board's own
screens in Herdr.
