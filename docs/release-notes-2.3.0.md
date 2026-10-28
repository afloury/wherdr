## New

Settings › Agents groups worktrees by machine and project in collapsible sections, making larger worktree lists easier to browse.

## Improved

Projects show a lightweight header even without a coordinator. Coordinator headers display the project key on their accent square when one is known.

Notification state appears in row menus as Mute notifications or Unmute notifications, available with a right click or long press. Rows no longer show a muted bell, and card menus show the notification action only once.

The README introduction has a new WebP animation showing the current interface.

## Fixed

When creating an agent, the name you type now labels the new space or the pane in an existing space, including spaces in the name. Thanks to [@SunnySydeUp](https://github.com/SunnySydeUp) for the contribution.

npm publication starts only after the GitHub release and its package are public, preventing the previous "release not found" race. The TaskSheet model and effort test now waits for menu focus to return before opening the next menu, preventing timing-dependent CI failures.

## Update

This release adds features to 2.2.0 and therefore uses version 2.3.0 rather than 2.2.1. No migration is required from 2.2.0; existing tasks and settings are kept. Node.js 22 or newer and Herdr 0.9.1 or newer are still required. Users upgrading from 1.x should follow the [2.0 migration guide](https://github.com/afloury/wherdr/blob/v2.3.0/docs/herdr-projects-1x.md).

[Full changelog](https://github.com/afloury/wherdr/blob/v2.3.0/CHANGELOG.md)
