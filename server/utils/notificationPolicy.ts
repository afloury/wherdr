// Notifications from `herdr notification show` (plugins, scripts), received by
// herdrNotify.ts. Only "custom" notifications go out as push: the
// others (needs attention, finished) are agent state changes,
// already notified by wherdr (state.ts) — relaying them would duplicate.
export interface NoticeLike { kind: string, title: string, body: string | null }
export const forwardableNotice = (n: NoticeLike) => n.kind === 'custom' && Boolean(n.title.trim())

// Same notification received twice (two profiles to the same machine,
// reconnection, repeating plugin): a single push per window.
export class NoticeDeduper {
  private seen = new Map<string, number>()
  constructor(private windowMs = 60000) {}
  fresh(key: string, now = Date.now()): boolean {
    for (const [k, at] of this.seen) if (now - at >= this.windowMs) this.seen.delete(k)
    if (this.seen.has(key)) return false
    this.seen.set(key, now)
    return true
  }
}
// Without the machine: the same message coming by two paths only rings once.
export const noticeKey = (n: NoticeLike) => `${n.title.trim()}\n${(n.body || '').trim()}`
