// When the on-screen prompt of a pane is read again (see choicesFor in
// state.ts). Herdr's `revision` does not always move when the screen changes,
// so a reading is also redone every SCREEN_MS while it may be stale: an
// interactive terminal, prompt or waiting screen is shown, the screen is
// watched, or the agent is blocked without a recognized quota wait
// (its box may not have been readable the first time: drawn just after, or a
// read that timed out, and that empty reading would otherwise stay for good).
export const SCREEN_MS = 3000
export const CHOICE_MS = 1000

export interface ScreenReading { rev: unknown, strict: boolean, at: number, choices: unknown, screen: unknown, menu: unknown, interaction?: string, usageLimit?: unknown, unavailable?: boolean }

export function keepReading(c: ScreenReading | undefined, rev: unknown, strict: boolean, watch: boolean, now: number, viewed = false): boolean {
  if (!c || c.unavailable || c.rev !== rev || c.strict !== strict) return false
  // Quota waits can last hours. Their next revision invalidates this cache;
  // a recognized wait needs no periodic retry even if Herdr calls it blocked.
  const live = watch || (!strict && !c.usageLimit) || Boolean(c.choices || c.screen || c.menu || c.interaction === 'terminal')
  return !(live && now - c.at >= (c.choices && viewed ? CHOICE_MS : SCREEN_MS))
}

// A delete also invalidates reads already in flight, even on a cache miss.
// An old capture must not acquire a fresh timestamp after an answer/nav.
export class ScreenCache<T> extends Map<string, T> {
  private sequence = 0
  private versions = new Map<string, number>()
  version(id: string): number {
    if (!this.versions.has(id)) this.versions.set(id, ++this.sequence)
    return this.versions.get(id)!
  }
  override delete(id: string): boolean {
    if (this.versions.has(id)) this.versions.set(id, ++this.sequence)
    return super.delete(id)
  }
  override clear() {
    this.versions.clear()
    super.clear()
  }
  forget(id: string) {
    this.versions.delete(id)
    super.delete(id)
  }
}
