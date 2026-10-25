# Files and changes

[Documentation](README.md) · [Project](../README.md)

- **Changes view**: Git status and diff of an agent's working folder; worktree management.
  Review the diff like a pull request: comment on one line or on a **block of lines**. The code
  itself is plain text — a click on it does nothing, so it can be selected and copied.
  - **Mouse**: a **+** appears in the gutter of the hovered line; click it to comment that line,
    or press it and drag over other lines to comment the block. With an editor open, Shift+click
    another line to change its block.
  - **Touch**: tap a line number to choose the line, tap another line to extend the block, then
    **Comment** in the bar pinned at the bottom. Nothing is written by the first tap.
  - **Keyboard**: one tab stop per file; arrow keys move between lines, Shift+arrows choose a
    block, Enter opens the editor. In the editor, ⌘/Ctrl+Enter saves and Escape cancels (a second
    Escape if text would be lost); the window stays open.

  A block stays within one hunk (the other hunks dim while it is chosen) and may mix deleted and
  new lines. Each comment is a thread under the last line of its block, headed by its lines
  ("Lines 12–18"), with **Edit** and a two-step **Delete**; the lines it covers are marked in
  the gutter. Comments, including the text of an editor left open, are saved on this device for
  that agent, across refreshes and reloads. A block that leaves the diff, or whose code changed
  between its first and last lines, is flagged above the diff and keeps the excerpt that was
  commented.
  **Send review** stays pinned with the number of comments; it groups them by file as
  `file:12-18 — remark` (`file:12` for one line) followed by a short excerpt of the block, and
  appends them to the conversation's message draft, preserving existing text; it never sends a
  message. Deleted lines use the old file's numbers, explicitly labelled. **Discard** clears the
  local review. Works on remote agents and in the demo too, with no writes to the agent's
  machine. Browser storage must be available to retain comments after closing the view.
