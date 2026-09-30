// Redémarrage du serveur (redéploiement) : son premier état peut être partiel.
// Le serveur ne se dit « prêt » qu'une fois la liste des machines lue, la
// machine locale sondée et chaque machine distante soit sondée, soit déclarée
// hors ligne (ou au bout de READY_MAX_MS, pour ne jamais rester bloqué).
// L'app garde son dernier état tant que le serveur n'est pas prêt, puis, juste
// après une reconnexion, garde les panes des machines qui se reconnectent :
// la vue ouverte ne se démonte jamais pour une raison passagère.
import type { HerdrState, MachineInfo } from './types'
import { LOCAL, machineOf } from './ids'

export const READY_MAX_MS = 20000

export interface ReadyInput {
  machinesListed: boolean
  localPolled: boolean
  remotes: { status: MachineInfo['status'], polled: boolean }[]
  elapsedMs: number
}

export function serverReady(i: ReadyInput): boolean {
  if (i.elapsedMs >= READY_MAX_MS) return true
  return i.machinesListed && i.localPolled && i.remotes.every(r => r.polled || r.status === 'offline')
}

// État à afficher : null = garder l'état actuel. `settling` : reconnexion
// récente (le serveur a pu redémarrer).
export function settleState(prev: HerdrState | null, next: HerdrState, settling: boolean): HerdrState | null {
  if (!prev || !prev.ok) return next
  if (next.ready === false) return null
  if (!settling || !next.ok) return next
  // Panes de machines distantes absentes de l'état reçu, ou pas encore en ligne :
  // on garde leur dernier état (grisé comme une machine hors ligne).
  const online = new Set([LOCAL, ...(next.machines || []).filter(m => m.status === 'online').map(m => m.key)])
  const present = new Set(next.panes.map(p => machineOf(p.id)))
  const keep = (id: string) => {
    const m = machineOf(id)
    return m !== LOCAL && !online.has(m) && !present.has(m)
  }
  const panes = prev.panes.filter(p => keep(p.id))
  if (!panes.length) return next
  const kept = new Set(panes.map(p => machineOf(p.id)))
  const known = new Set((next.machines || []).map(m => m.key))
  const lost = (prev.machines || []).filter(m => kept.has(m.key) && !known.has(m.key))
    .map((m): MachineInfo => ({ ...m, status: 'connecting' }))
  const localInfo: MachineInfo[] = next.machines ? [] : (prev.machines || []).filter(m => m.key === LOCAL)
  return {
    ...next,
    workspaces: [...next.workspaces, ...prev.workspaces.filter(w => keep(w.id))],
    tabs: [...(next.tabs || []), ...(prev.tabs || []).filter(t => keep(t.id))],
    panes: [...next.panes, ...panes],
    machines: [...localInfo, ...(next.machines || []), ...lost],
  }
}
