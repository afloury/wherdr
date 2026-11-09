# Alfred's command: `wherdr alfred`

[Alfred](home.md#alfred), wherdr's assistant, acts on wherdr with `wherdr alfred <command>`, a small command written
in its home folder (`alfred/bin/wherdr` in wherdr's data folder). It talks to the wherdr server
on this machine only, with a token wherdr writes to `alfred/.alfred-token` (mode 600) at each
Alfred start; a call relayed from the tailnet or anywhere else is refused, whatever its token.
Each answer is JSON.

Reading:

| Command | Answers |
| --- | --- |
| `wherdr alfred projects` | whether projects are on, and each project (key, name, machine, folder, template) |
| `wherdr alfred project <KEY>` | one project, its coordinator and its tasks by state |
| `wherdr alfred templates` | the saved templates, and the examples (`example:<id>`) a project's template can start from |
| `wherdr alfred machines` | the machines herdr-core knows (key, label, status); `""` is this machine |
| `wherdr alfred coordinators` | each coordinator, its agent and whether it runs (`stopped`: its terminal ended, see `--resume`) |
| `wherdr alfred coordinator open <KEY>` | the link that opens a running project coordinator |
| `wherdr alfred last <KEY>` | what the project's coordinator last said (its last message, else the bottom of its screen), and whether it is still working |
| `wherdr alfred v2` | when you come from wherdr v2: the projects its migration listed, their open tasks, the v3 project made from each, and the migration report ([set up your v2 projects](migrate-from-v2.md#set-up-your-v2-projects-with-alfred)) |
| `wherdr alfred settings` | the synced settings, their values, and the values each setting Alfred may change accepts (`1` on, `0` off) |
| `wherdr alfred help` | this list |

Changing (show, then do):

| Command | Does |
| --- | --- |
| `wherdr alfred project add <KEY> --machine <key> --path <folder> [--name <name>] [--template <id>]` | adds a project: a git folder inside the home folder of a machine, not already a project (on this machine, checked before the yes too) |
| `wherdr alfred project template <KEY> <id\|none>` | gives the project a template (a saved one or `example:<id>`), or none |
| `wherdr alfred project guards <KEY> [--protect <branch,branch\|none>] [--merge-protected user\|engine] [--merge-others user\|engine] [--contributor-prs off\|others\|all]` | the project's [guards](project-management.md#guards): protected branches, who merges into them and into the others (`user`: you, `engine`: wherdr), and whether its coordinator may merge an outside contributor's PR after your yes; without an option, only shown |
| `wherdr alfred project machine add <KEY> <machine> --clone <folder>` | lets the project's tasks run on another machine (its key or label), in its clone of the repository there; once applied, the machine's [readiness check](project-management.md#board) runs and its result is in the answer |
| `wherdr alfred project machine remove <KEY> <machine>` | the project's tasks no longer start on that machine (tasks already there stay) |
| `wherdr alfred coordinator start <KEY> [--program claude\|codex] [--resume]` | starts the project's coordinator with its harness's default model; without `--program`, the user's first offered agent that can run it (Settings › Agents) (a new conversation replaces a running one); `--resume` takes up its last conversation again, with the agent that ran it |
| `wherdr alfred setting set <key> <value>` | changes a setting to one of the values `settings` lists for it (a theme id from the theme list, for instance); lists such as machine groups or hidden agents stay in Settings |

A change without `--apply` changes nothing: it prints what it would do (`dryRun`, `change`) and
the command that makes it. Alfred shows you those lines and runs that command, with `--apply`,
only after your yes in the chat. When the answer names a `remote` machine (a project on another
machine, its coordinator), Alfred makes the change only when you asked for it. No `wherdr alfred`
command deletes anything (removing a project's machine leaves its clone and tasks there): removing a project, a template or a setting stays yours, in Settings.
The one removal a coordinator has is `wherdr pm task remove`, for a task never started.

Proposing and delegating (no `--apply`):

| Command | Does |
| --- | --- |
| `wherdr alfred project workflow edit <KEY> < workflow.json` | proposes a new workflow for the project (the whole JSON, guards unchanged). Nothing changes yet: you accept or refuse it in the project's [Workflow tab](project-management.md#workflow), in the same review as a coordinator's proposal. Only on your request in Alfred's chat, never in a wake |
| `wherdr alfred tell <KEY> "<text>"` | sends a message to the project's coordinator, starting it when it does not run, and writes it to the project's log as from Alfred. When Alfred relays your message, the coordinator's turn counts as yours; otherwise as a wake |

So you can ask Alfred "propose a workflow for WEB": it tells WEB's coordinator, reads its reply
with `last`, and reports back; the proposal itself waits for your answer in wherdr.

```text
$ wherdr alfred project template WEB company
{ "dryRun": true, "change": ["project WEB template: none → company"],
  "next": "Show this to the user; only after their yes, run: wherdr alfred project template WEB company --apply" }
```

## After an update

When wherdr starts (after an update too), it rewrites the instructions (`AGENTS.md` and the files
beside it) of Alfred and of every running project coordinator. It sends them no message and wakes
none of them. Each one learns of the update on its next `wherdr alfred` or `wherdr pm` command,
once: the answer starts with the line
`wherdr was updated to <version> since your session started: re-read AGENTS.md and check docs/llms.txt before relying on what you knew`.

Alfred and the coordinators never explain wherdr from memory: they read `docs/llms.txt` (the
docs index) first, then only the sections that answer. `wherdr alfred help` and `wherdr pm help`
list the commands of the wherdr that runs now.
