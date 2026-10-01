import type { Pane } from '../../shared/types'
import { isProjectThread } from '../../shared/paneTitle'
export { isProjectThread } from '../../shared/paneTitle'

export type NotifyScope = 'project_leads' | 'all'

export function shouldNotify(scope: NotifyScope | undefined, p: Pick<Pane, 'name' | 'cwd'>): boolean {
  return scope === 'all' || !isProjectThread(p)
}

// ---------------------------------------------------------------- herdr notification
// Notifications from `herdr notification show` (plugins, scripts), received by
// herdrNotify.ts. Only "custom" notifications go out as push: the
// others (needs attention, finished) are agent state changes,
// already notified by wherdr (state.ts) — relaying them would duplicate.
export interface NoticeLike { kind: string, title: string, body: string | null }
export const forwardableNotice = (n: NoticeLike) => n.kind === 'custom' && Boolean(n.title.trim())

// herdr-projects titles its notifications "<Project> · <topic>"; the topic is
// the thread identifier (t-0015) when it is about a thread.
const THREAD_NOTICE = /^(.+?) · (t-\d{4,})$/
export function projectThreadOfNotice(title: string): { project: string, thread: string } | null {
  const m = THREAD_NOTICE.exec(title.trim())
  return m ? { project: m[1]!.trim(), thread: m[2]! } : null
}

// Same rule as for agents: a herdr-projects thread only notifies the
// devices set to "All agents".
export function shouldNotifyNotice(scope: NotifyScope | undefined, title: string): boolean {
  return scope === 'all' || !projectThreadOfNotice(title)
}

// Pane of the thread (notification link): name or folder `hp-<project>-t-0015…`
// (herdr-projects shows "Wherdr" for the "wherdr" project).
export function findThreadPane<P extends Pick<Pane, 'id' | 'name' | 'cwd'>>(panes: P[], project: string, thread: string): P | null {
  const slug = project.toLowerCase().trim().replace(/\s+/g, '-')
  const mark = new RegExp(`(^|/)hp-${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${thread}(?:-|/|$)`, 'i')
  const hits = panes.filter(p => isProjectThread(p) && ((p.name && mark.test(p.name)) || (p.cwd && mark.test(p.cwd))))
  return hits.length === 1 ? hits[0]! : null
}

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
