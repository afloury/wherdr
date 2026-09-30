import { describe, expect, it } from 'vitest'
import type { HerdrState, Pane } from '../shared/types'
import { READY_MAX_MS, serverReady, settleState } from '../shared/stateReady'

const pane = (id: string): Pane => ({ id, workspace: id.replace(/:p\d+$/, ''), status: 'idle', agent: 'claude' } as unknown as Pane)
const st = (panes: string[], extra: Partial<HerdrState> = {}): HerdrState => ({
  ok: true,
  workspaces: [...new Set(panes.map(p => p.replace(/:p\d+$/, '')))].map((id, i) => ({ id, label: id, number: i + 1, status: null })),
  tabs: [],
  panes: panes.map(pane),
  ...extra,
})
const REMOTE = 'abcd1234'
const machines = (status: 'online' | 'connecting' | 'offline') => [
  { key: '', label: 'local', local: true, status: 'online' as const, error: null },
  { key: REMOTE, label: 'remote', local: false, status, error: null },
]

describe('serverReady', () => {
  const base = { machinesListed: true, localPolled: true, remotes: [], elapsedMs: 0 }
  it('attend la liste des machines et le premier sondage local', () => {
    expect(serverReady({ ...base, machinesListed: false })).toBe(false)
    expect(serverReady({ ...base, localPolled: false })).toBe(false)
    expect(serverReady(base)).toBe(true)
  })
  it('attend chaque machine distante, sauf hors ligne', () => {
    expect(serverReady({ ...base, remotes: [{ status: 'connecting', polled: false }] })).toBe(false)
    expect(serverReady({ ...base, remotes: [{ status: 'online', polled: true }] })).toBe(true)
    expect(serverReady({ ...base, remotes: [{ status: 'offline', polled: false }] })).toBe(true)
  })
  it('ne reste jamais bloqué', () => {
    expect(serverReady({ ...base, machinesListed: false, elapsedMs: READY_MAX_MS })).toBe(true)
  })
})

describe('settleState', () => {
  const prev = st(['w1:p1', `${REMOTE}~w1:p1`], { machines: machines('online') })

  it('ignore un état « pas prêt » quand un état est déjà affiché', () => {
    expect(settleState(prev, st([], { ready: false }), true)).toBeNull()
    expect(settleState(prev, st([], { ready: false }), false)).toBeNull()
  })
  it('applique un état « pas prêt » au premier chargement', () => {
    const next = st([], { ready: false })
    expect(settleState(null, next, false)).toBe(next)
  })
  it('garde les panes d’une machine qui se reconnecte juste après une reconnexion', () => {
    const next = st(['w1:p1'], { machines: machines('connecting') })
    const r = settleState(prev, next, true)!
    expect(r.panes.map(p => p.id)).toEqual(['w1:p1', `${REMOTE}~w1:p1`])
    expect(r.workspaces.map(w => w.id)).toContain(`${REMOTE}~w1`)
  })
  it('garde la machine même absente de la liste (profils pas encore relus)', () => {
    const r = settleState(prev, st(['w1:p1']), true)!
    expect(r.panes.map(p => p.id)).toContain(`${REMOTE}~w1:p1`)
    expect(r.machines!.find(m => m.key === REMOTE)!.status).toBe('connecting')
  })
  it('hors reconnexion, l’état reçu fait foi', () => {
    const next = st(['w1:p1'], { machines: machines('connecting') })
    expect(settleState(prev, next, false)).toBe(next)
  })
  it('une machine en ligne sans panes est prise telle quelle', () => {
    const next = st(['w1:p1'], { machines: machines('online') })
    expect(settleState(prev, next, true)).toBe(next)
  })
})
