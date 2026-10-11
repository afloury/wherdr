import type { ScreenInteraction } from '#shared/interactiveScreen'

// One episode lasts until a stable return to the message field. Cursor motion,
// transient native prompts and missed reads cannot undo a manual dismissal.
export function createInteractionWindow() {
  let kind: ScreenInteraction = 'unknown'
  let since = 0
  let open = false
  let dismissed = false
  return {
    // Re-entry with a field already observed: never mount a stale terminal.
    resume(next: ScreenInteraction) {
      if (next === 'input' || next === 'native' || next === 'managed') open = false
      if (next === 'input') dismissed = false
      kind = 'unknown'
      return open
    },
    update(next: ScreenInteraction, now: number) {
      if (next !== kind) { kind = next; since = now }
      // A server-owned operation or recovery card must never share input with
      // the TUI. It does not end an episode or undo a manual dismissal.
      if (next === 'managed' || next === 'native') open = false
      if (next === 'input' && now - since >= 900) { open = false; dismissed = false }
      if (next === 'terminal' && now - since >= 500 && !dismissed) open = true
      return open
    },
    dismiss() { dismissed = true; open = false },
    reopen() { dismissed = false; open = true },
  }
}

// Preserve a manual dismissal when switching tabs and returning to the pane.
// Bounded device-local state, without terminal text or user data.
const windows = new Map<string, ReturnType<typeof createInteractionWindow>>()
export function interactionWindowFor(paneId: string) {
  let window = windows.get(paneId)
  if (!window) {
    window = createInteractionWindow()
    if (windows.size >= 64) windows.delete(windows.keys().next().value!)
    windows.set(paneId, window)
  }
  return window
}
