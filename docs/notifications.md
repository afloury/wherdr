# Notifications

[Documentation](README.md) · [Project](../README.md)

## Notifications

With notifications enabled on a device, wherdr sends a Web Push when an agent goes from working
to **blocked** (with its question and options) or to **done** (with the start of its answer).
There is no push for the agent currently on screen.

**Do not disturb** (top of Settings → Notifications) stops every push, for this device or for all
devices, for 1 hour, until 8 am or until turned back on. The server applies it before sending and
keeps it across restarts (`data/quiet.json` for all devices). While it is on, the agent list
shows one line, “Notifications silenced until 08:00”, that opens these settings (a crossed-out bell
under the counters when the list is collapsed); the header keeps its buttons as they are.

wherdr also relays custom notifications sent with `herdr notification show` (plugins, scripts).
To receive them it connects to Herdr's client socket as a **passive** client: it never becomes
the foreground client and never resizes anything. Side effects: with wherdr connected,
`notification show` reports `shown: true` even with no terminal attached, and an empty session
gets a default workspace, as with any attached client.

## Rules shared across devices

Settings → Notifications stores its policy with the other synchronized settings
(`notificationRules` in `settings.json`). A conversation overrides its project,
which overrides its machine. **Inherit** removes the override. Timed mutes expire
back to inheritance after 1 or 8 hours; permanent mutes last until removed.

Ordinary conversations and custom notices are quiet by default. Coordinators
notify for **needs you** and **finished**. The **Mute sub-agents** preset is enabled
by default: board workers, reviewers, planners and attempts stay silent even if a
machine or project allows notifications. An explicit conversation rule can enable
one. Use **Only main coordinators** to mute every known machine and enable its main
coordinator; the Notifications menu also lets you enable just one conversation.

A rule can select needs you (including permission requests), finished, new assistant
messages, and scheduled tasks independently. New assistant messages are identified
by their transcript position, so streaming updates do not ring repeatedly. Custom
`herdr notification show` notices follow the same policy: notices with a pane use
that conversation; other notices use their machine. Scripts can mark a scheduled
notice with a `[scheduled]` title prefix. Board approval/failure notices count as
needs you and use the task's linked conversation where available.

An open conversation suppresses push to **every** device while the page is visible,
focused and recently used (within two minutes). A WebSocket heartbeat renews a
30-second lease every 10 seconds. Hiding, closing, losing the connection or leaving
an idle tab stops renewing it; push resumes when the last lease expires. The global
Do not disturb setting and notification deduplication still apply.
