import { describe, expect, it } from 'vitest'
import { CoreError } from '../server/utils/core'
import { coreRename, coreSeen } from '../server/utils/coreSeen'
import type { CoreInputDeps } from '../server/utils/coreInput'
import { coreUnread, seenUpdate } from '../shared/coreInventory'
import { coreState } from '../shared/coreState'
import type { Pane } from '../shared/types'

function deps(terminal: object = {}, fail?: CoreError) {
  const calls: [string, any][] = []
  const panes = [{ id: 't1', workspace: 'w1', coreAddress: 'm/t1', agent: 'claude' } as Pane]
  const d: CoreInputDeps = {
    call: async (method, params) => {
      calls.push([method, params])
      if (fail) throw fail
      return (method === 'terminal.get' ? terminal : {}) as never
    },
    pane: id => panes.find(p => p.id === id),
    panes: () => panes,
    refresh: () => {},
  }
  return { d, calls }
}
const term = (turn: number, seen?: string) => ({ address: 't1', cwd: '/w/a', state: 'live', turn, status: { state: 'idle' }, ...(seen !== undefined ? { labels: { 'herdr.seen': seen } } : {}) })

describe('herdr.seen rules', () => {
  it('is unread only when the label exists and is behind the turn', () => {
    expect(coreUnread(term(3, '2'))).toBe(true)
    expect(coreUnread(term(3, '3'))).toBe(false)
    expect(coreUnread(term(3))).toBe(false) // absent is not 0
    expect(coreUnread(term(0, '0'))).toBe(false)
    expect(coreUnread(term(3, 'x'))).toBe(false)
  })
  it('only writes upward on read, one turn behind on unread', () => {
    expect(seenUpdate(term(3, '1'), true)).toBe('3')
    expect(seenUpdate(term(3, '3'), true)).toBeNull()
    expect(seenUpdate(term(3, '5'), true)).toBeNull()
    expect(seenUpdate(term(3), true)).toBe('3')
    expect(seenUpdate(term(3, '3'), false)).toBe('2')
    expect(seenUpdate(term(3, '2'), false)).toBeNull()
    expect(seenUpdate(term(0, '0'), false)).toBeNull()
  })
  it('turns an idle agent into done when unread, and keeps untracked ones idle', () => {
    const state = coreState([term(3, '2'), { ...term(3, '3'), address: 't2' }, { ...term(3), address: 't3' }, { ...term(3, '0'), address: 't4', status: { state: 'working' } }], [])
    expect(state.panes.map(p => p.status)).toEqual(['done', 'idle', 'idle', 'working'])
  })
})

describe('core seen route', () => {
  it('marks read with the current turn, once', async () => {
    const t = deps(term(4, '2'))
    expect(await coreSeen(t.d, { pane_id: 't1' })).toEqual({ ok: true, changed: true })
    expect(t.calls).toEqual([['terminal.get', { terminal: 'm/t1' }], ['terminal.label', { terminal: 'm/t1', labels: { 'herdr.seen': '4' } }]])
    const again = deps(term(4, '4'))
    expect(await coreSeen(again.d, { pane_id: 't1' })).toMatchObject({ changed: false })
    expect(again.calls.map(c => c[0])).toEqual(['terminal.get'])
  })
  it('marks unread one turn behind', async () => {
    const t = deps(term(4, '4'))
    await coreSeen(t.d, { pane_id: 't1', read: false })
    expect(t.calls[1]).toEqual(['terminal.label', { terminal: 'm/t1', labels: { 'herdr.seen': '3' } }])
  })
  it('rejects an unknown pane and maps core errors', async () => {
    await expect(coreSeen(deps().d, { pane_id: 'zz' })).rejects.toMatchObject({ code: 'bad_pane' })
    await expect(coreSeen(deps({}, new CoreError('not_found', 'x')).d, { pane_id: 't1' })).rejects.toMatchObject({ code: 'stale' })
  })
})

describe('core rename route', () => {
  it('sets herdr.title, trimmed, and removes it when empty', async () => {
    const t = deps()
    expect(await coreRename(t.d, { pane_id: 't1', label: '  my   build  ' })).toEqual({ ok: true, label: 'my build' })
    expect(await coreRename(t.d, { pane_id: 't1', label: '' })).toEqual({ ok: true, label: null })
    expect(t.calls).toEqual([
      ['terminal.label', { terminal: 'm/t1', labels: { 'herdr.title': 'my build' } }],
      ['terminal.label', { terminal: 'm/t1', labels: { 'herdr.title': '' } }],
    ])
    await expect(coreRename(t.d, { pane_id: 'zz', label: 'x' })).rejects.toMatchObject({ code: 'bad_pane' })
  })
  it('shows the chosen name, then the creation name, as the pane label', () => {
    const named = coreState([{ address: 't1', cwd: '/w/a', state: 'live', name: 'shell-a', labels: { 'herdr.title': 'Deploy' } }, { address: 't2', cwd: '/w/a', state: 'live', name: 'shell-b' }, { address: 't3', cwd: '/w/a', state: 'live' }], [])
    expect(named.panes.map(p => p.label)).toEqual(['Deploy', 'shell-b', null])
  })
  it('orders by status_ms (or the turn) as stateSeq', () => {
    const s = coreState([{ address: 't1', cwd: '/w', state: 'live', status_ms: 1700, turn: 2 }, { address: 't2', cwd: '/w', state: 'live', turn: 5 }, { address: 't3', cwd: '/w', state: 'live' }], [])
    expect(s.panes.map(p => p.stateSeq)).toEqual([1700, 5, undefined])
  })
})
