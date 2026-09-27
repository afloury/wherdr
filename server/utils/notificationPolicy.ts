import type { Pane } from '../../shared/types'
import { isProjectThread } from '../../shared/paneTitle'
export { isProjectThread } from '../../shared/paneTitle'

export type NotifyScope = 'project_leads' | 'all'

export function shouldNotify(scope: NotifyScope | undefined, p: Pick<Pane, 'name' | 'cwd'>): boolean {
  return scope === 'all' || !isProjectThread(p)
}

// ---------------------------------------------------------------- herdr notification
// Notifications de `herdr notification show` (plugins, scripts), reçues par
// herdrNotify.ts. Seules les notifications « custom » partent en push : les
// autres (needs attention, finished) sont les changements d'état des agents,
// déjà notifiés par wherdr (state.ts) — les relayer ferait doublon.
export interface NoticeLike { kind: string, title: string, body: string | null }
export const forwardableNotice = (n: NoticeLike) => n.kind === 'custom' && Boolean(n.title.trim())

// herdr-projects titre ses notifications « <Projet> · <sujet> » ; le sujet est
// l'identifiant du thread (t-0015) quand elle parle d'un thread.
const THREAD_NOTICE = /^(.+?) · (t-\d{4,})$/
export function projectThreadOfNotice(title: string): { project: string, thread: string } | null {
  const m = THREAD_NOTICE.exec(title.trim())
  return m ? { project: m[1]!.trim(), thread: m[2]! } : null
}

// Même règle que pour les agents : un thread herdr-projects ne notifie que les
// appareils réglés sur « Tous les agents ».
export function shouldNotifyNotice(scope: NotifyScope | undefined, title: string): boolean {
  return scope === 'all' || !projectThreadOfNotice(title)
}

// Pane du thread (lien de la notification) : nom ou dossier `hp-<projet>-t-0015…`
// (herdr-projects affiche « Wherdr » pour le projet « wherdr »).
export function findThreadPane<P extends Pick<Pane, 'id' | 'name' | 'cwd'>>(panes: P[], project: string, thread: string): P | null {
  const slug = project.toLowerCase().trim().replace(/\s+/g, '-')
  const mark = new RegExp(`(^|/)hp-${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${thread}(?:-|/|$)`, 'i')
  const hits = panes.filter(p => isProjectThread(p) && ((p.name && mark.test(p.name)) || (p.cwd && mark.test(p.cwd))))
  return hits.length === 1 ? hits[0]! : null
}

// Même notification reçue deux fois (deux profils vers la même machine,
// reconnexion, plugin qui répète) : une seule push par fenêtre.
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
// Sans la machine : un même message venu par deux chemins ne sonne qu'une fois.
export const noticeKey = (n: NoticeLike) => `${n.title.trim()}\n${(n.body || '').trim()}`
