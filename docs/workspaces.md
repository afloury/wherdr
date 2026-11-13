# Workspaces

[Documentation](README.md) · [Project management](project-management.md)

A **workspace** is a project of its own kind whose coordinator runs a set of
linked repositories, for work that spans several of them (an API and the app
that calls it, for instance). It has no git: its folder is a root such as
`~/work`, under which the repositories are cloned. It belongs to one home tab
group; a group may hold several workspaces.

Each repository the workspace works on is a **member project**: an ordinary
project, with its own key, tasks and board, but **no coordinator of its own**.
The workspace's coordinator handles it. A repository belongs to one workspace
at most, and a workspace is never itself in a workspace.

## Shared settings

A workspace holds the settings its members take:

- the **machines** beside its own, and the **clone root** on each. A member's
  clone on a machine is `<root>/<repo path>`: with the root `~/work` at home and
  `/srv/work` on another machine, the member `~/work/payroll-api` runs in
  `/srv/work/payroll-api` there. A member runs only on the machines that have
  its clone under the root: nothing is cloned for you;
- the paused machines and the placement;
- the base branch and the branch name template;
- the agents, models and [reviewer fallback](project-management.md#reviewer-fallback);
- the worktree setup;
- *Archive done tasks after* and *Delete the task's branch after its merge*.

A member stores only its key, name, machine, folder, workspace and repository
visibility. Each setting comes from the workspace unless the member **overrides**
it: a field the member sets itself is its own from then on (the list is kept
in its `overrides`). Clearing the member's base branch or branch name template
gives the workspace's back. Everything that reads a project's settings, the
engine and the coordinator's commands included, reads them with the overrides
applied.

## Shared workflow

A workspace has its own workflow, proposed and accepted like a project's
(`template show` and `template edit` on the workspace work on it). A member
without a workflow of its own runs the workspace's; a member may have its own
instead (a repository with a different review, for instance): the first
workflow accepted for the member becomes its own, and its tasks move to it.
The member's Workflow and Guards tabs show the workspace's workflow it runs,
with a line that says so; a change saved there gives the member its own.

The workspace's [guards](project-management.md#guards) apply to every member,
its own workflow included: they sit between your settings and the project's,
and the strictest wins, so a member can add protected branches or keep a merge
for you, never loosen the workspace's. For a member, `template show` lists them
apart (`workspaceGuards`) and says when it runs the workspace's workflow.

## Features

A workspace's tasks are **features**, never ordinary tasks: wherdr refuses any
other task type on a workspace and asks to add the task to one of its member
projects instead. A feature has no agent; its sub-tasks are ordinary tasks of
the members, one per repository.
