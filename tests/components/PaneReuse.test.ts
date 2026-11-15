import { describe, expect, it } from 'vitest'
import { createPaneReuse } from '~/composables/useHerdr'
import type { HerdrState, Pane } from '#shared/types'

const pane = (id: string, extra: Partial<Pane> = {}): Pane => ({ id, workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/home/user/demo', agentSession: null, ...extra })
const state = (panes: Pane[]): HerdrState => ({ ok: true, workspaces: [], panes })
// Each push is parsed afresh from the socket: new objects every time.
const push = (panes: Pane[]) => JSON.parse(JSON.stringify(state(panes))) as HerdrState

describe('live state pane reuse', () => {
  it('keeps the previous object of an unchanged pane and takes the new one of a changed pane', () => {
    const r = createPaneReuse()
    const first = r.reuse(push([pane('w1:p1'), pane('w1:p2')]))
    const second = r.reuse(push([pane('w1:p1'), pane('w1:p2', { status: 'working', preview: 'Reading files' })]))
    expect(second.panes[0]).toBe(first.panes[0])
    expect(second.panes[1]).not.toBe(first.panes[1])
    expect(second.panes[1]).toMatchObject({ status: 'working', preview: 'Reading files' })
    // The changed pane is the one kept for the next push.
    const third = r.reuse(push([pane('w1:p1'), pane('w1:p2', { status: 'working', preview: 'Reading files' })]))
    expect(third.panes[1]).toBe(second.panes[1])
  })

  it('forgets panes that left, and starts over after clear', () => {
    const r = createPaneReuse()
    const first = r.reuse(push([pane('w1:p1')]))
    r.reuse(push([]))
    const back = r.reuse(push([pane('w1:p1')]))
    expect(back.panes[0]).not.toBe(first.panes[0])
    r.clear()
    expect(r.reuse(push([pane('w1:p1')])).panes[0]).not.toBe(back.panes[0])
  })

  it('keeps the order and contents of the pushed list', () => {
    const r = createPaneReuse()
    r.reuse(push([pane('w1:p1'), pane('w1:p2')]))
    const next = r.reuse(push([pane('w1:p2'), pane('w1:p3'), pane('w1:p1')]))
    expect(next.panes.map(p => p.id)).toEqual(['w1:p2', 'w1:p3', 'w1:p1'])
    expect(next).toEqual(state([pane('w1:p2'), pane('w1:p3'), pane('w1:p1')]))
  })
})
