# wherdr 2.0.0

A major upgrade from **1.3.4**, with the new work board and a native service.

> **Upgrading from 1.x? Back up first and read the Update section below.**
> wherdr 2.0 has no Docker image: on a 1.x Docker install, the suggested `docker compose pull`
> keeps 1.3.4. Follow the [Docker migration guide](https://github.com/afloury/wherdr/blob/v2.0.0/docs/migrate-from-1.x-docker.md) instead.

## New

The new Board works with herdr-projects 1.2.1 or later across your machines: create,
start, queue, stop, retry, approve and archive tasks, set dependencies, and talk to
project coordinators. Task panels bring together the conversation, terminal, review,
progress and actionable failures. Done is hidden by default and can be shown again.

Display settings follow you across devices through the server's `settings.json`,
including themes, machine groups, home list options, Board grouping and file browser
preferences. Changes reach connected devices immediately; offline changes are retried.

## Improved

The home screen starts with the normal, two-line task list. Machine groups and grouping
by state help you follow work across machines. The one-line Needs you banner offers
answers or permission actions and takes you to the question in the conversation.
The iPad layout stays stable with the keyboard open and has larger touch controls.
Files support formatted Markdown and video previews, and terminal mouse input uses
Herdr's structured events on supported versions. Slash commands include plugin skills
and MCP prompts. New can open or create a project coordinator.

Task logos distinguish workers, reviewers and fallbacks. Machine and group tabs restore
their last conversation, and task banners can send failed reviews back to the agent.
The bundled herdr-projects installer targets 1.2.21, while the Board still reads 1.2.1 or later.

The shorter README links to focused documentation pages. Startup instructions now
state the actual behavior: at login on macOS, at boot on Linux with lingering enabled,
otherwise at login. The installer reports which applies.

## Fixed

Messages removed from Claude's queue are reported as not sent with Retry. Messages
waiting behind a terminal menu explain why and offer Close menu or Send anyway.
Drafts follow an agent when its pane is replaced, rewritten transcripts reload correctly,
and Claude quota snapshots keep the account and observation together. Remote SSH
connections recover when an old connection leaves its control socket unusable.
Agent terminal copies (OSC 52) reach the browser clipboard when Herdr forwards them,
with a tap-to-copy fallback when a browser requires a gesture.

## Update

**This is a major upgrade from 1.x. Back up before updating.**

1. Back up wherdr's data directory and any herdr-projects 0.2 projects. Follow the
   [herdr-projects migration guide](https://github.com/afloury/wherdr/blob/v2.0.0/docs/herdr-projects-1x.md) (#152) before running upstream 1.x:
   it is a different program, and its first run moves the old directory aside.
   wherdr 2.0.0 requires herdr-projects **1.2.1 or later** for the Board. The old Project
   panel, TASKS.md, threads, inbox and routines integration are removed. Stay on
   wherdr **1.3.4** if you still need herdr-projects 0.2.
2. **Docker is removed.** Move to the native service with the
   [Docker migration guide](https://github.com/afloury/wherdr/blob/v2.0.0/docs/migrate-from-1.x-docker.md), keeping your port and data. You can hand that
   guide to an AI agent: it lists checkable steps and the way back. The plugin switches its old Docker mode to native on
   update and points to that guide. Existing 1.x images remain on GHCR for 1.x users.
3. Once 2.0.0 is published, update the native Herdr plugin with **U** in its panel or
   rerun the installer. For npm, run `npm install -g wherdr@2.0.0 && wherdr restart`;
   for Homebrew, run `brew upgrade wherdr && brew services restart wherdr`.
   Requirements remain Linux or macOS, Node.js 22 or newer, and Herdr 0.9.1 or newer
   (the herdr-projects migration guide uses Herdr 0.9.3 or newer).
4. Open each browser once. Its display settings fill only missing server keys; existing
   server values win. After that, shared settings belong to the server. Keep
   `DATA_DIR/settings.json` in your backups. Language, screen and terminal sizing,
   drafts, notifications and authentication remain device-specific.
5. Compact list from 1.x resets to Normal once. If you prefer Compact, turn it on again
   in Settings; that choice follows you to other devices. Check Settings and the Board
   after updating. The migration guide also documents rollback.

PRs #153, #154, #155, #157, #163 and #71 are deferred to 2.0.1.

[Full changelog](https://github.com/afloury/wherdr/blob/v2.0.0/CHANGELOG.md)
