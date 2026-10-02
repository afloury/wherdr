// When the on-screen prompt of a pane is read again (see choicesFor in
// state.ts). Herdr's `revision` does not always move when the screen changes,
// so a reading is also redone every SCREEN_MS while it may be stale: a prompt
// or waiting screen is shown, the screen is watched, or the agent is blocked
// (its box may not have been readable the first time: drawn just after, or a
// read that timed out, and that empty reading would otherwise stay for good).
export const SCREEN_MS = 3000

export interface ScreenReading { rev: unknown, strict: boolean, at: number, choices: unknown, screen: unknown, menu: unknown }

export function keepReading(c: ScreenReading | undefined, rev: unknown, strict: boolean, watch: boolean, now: number): boolean {
  if (!c || c.rev !== rev || c.strict !== strict) return false
  const live = watch || !strict || Boolean(c.choices || c.screen || c.menu)
  return !(live && now - c.at >= SCREEN_MS)
}
