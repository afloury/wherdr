// Compact list (Settings › Appearance), off unless the user turned it on:
// 2.0 makes the normal list (two lines for a task, with its current activity
// and useful labels) the default. The choice is kept under a new key, so a
// compact list turned on in 1.x (key `compactList`, on when missing) goes back
// to normal once, on the first 2.0 load, whether that value is still in the
// browser or already on the server. A choice made in 2.0 is kept.
export const COMPACT_LIST_KEY = 'compactListV2'
export const LEGACY_COMPACT_LIST_KEY = 'compactList'
export function readCompactList(stored: string | null): boolean {
  return stored === '1'
}

// What a one-line card keeps. Space: one state dot per tab when it has
// several tabs, otherwise its number of panes when it has several.
export interface CompactMeta { dots: boolean, panes: number | null }

export function compactMeta(o: { tabs?: number, panes?: number }): CompactMeta {
  const tabs = o.tabs ?? 0
  const panes = o.panes ?? 0
  return {
    dots: tabs > 1,
    panes: tabs <= 1 && panes > 1 ? panes : null,
  }
}

// A one-line card opens (the question and its one-tap answers, below the line)
// only while its agent waits for an answer and has something to show.
export function compactOpen(o: { status?: string | null, preview?: string | null, detail?: unknown, choices?: number }): boolean {
  return o.status === 'blocked' && Boolean(o.preview || o.detail || o.choices)
}

// One-tap answers that just appeared (an agent starts waiting, or asks
// something else) push the lines below them: a tap aimed at a line may land on
// the answer of another agent. For a moment after they appear, taps on them
// are ignored.
export const CHOICE_GUARD_MS = 400
export const choicesArmed = (shownAt: number, now: number) => now - shownAt >= CHOICE_GUARD_MS

// Is the list on screen, for the cards that mount in it? A card mounted while
// it is (an agent that starts waiting moves to another group) opens its
// answers with the transition; the cards of a list that comes on screen (first
// render, or back from a conversation on a phone) are just there.
export function createListShown(delay = 1000) {
  let shown = false
  let cards = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    shown: () => shown,
    mount() {
      cards++
      if (!shown && !timer) timer = setTimeout(() => { shown = true; timer = null }, delay)
    },
    // The last card gone: the list left the screen.
    unmount() {
      if (--cards > 0) return
      cards = 0
      shown = false
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
