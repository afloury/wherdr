import { describe, expect, it } from 'vitest'
import { coreRowCounts, coreState } from '../shared/coreState'
import type { CoreTerminal } from '../shared/coreInventory'
const terminal = (address: string, extra = {}): CoreTerminal => ({ address, cwd: '/workspace/demo', state: 'live', ...extra })
describe('core state for the existing interface', () => {
  it('groups a cwd on its machine, preserves addresses and stable navigation IDs', () => {
    const terminals = [terminal('t1'), terminal('t2', { template: 'codex', status: { state: 'working' } }), terminal('host-a/t1')]
    const state = coreState(terminals, [{ name: 'host-a', state: 'connected' }])
    expect(state.workspaces).toHaveLength(2)
    expect(state.tabs).toHaveLength(3)
    expect(state.panes.map(p => [p.coreAddress, p.agent, p.status])).toEqual([
      ['t1', null, 'unknown'], ['t2', 'codex', 'working'], ['host-a/t1', null, 'unknown'],
    ])
    expect(coreState([...terminals].reverse(), []).panes.map(p => p.id).reverse()).toEqual(state.panes.map(p => p.id))
    expect(state.machines?.[1]?.status).toBe('online')
  })
  it('keeps a disconnected machine distinct from an agent status', () => {
    const state = coreState([terminal('host-a/t1', { status: { state: 'error', app: 'claude-code' } })], [{ name: 'host-a', state: 'unreachable' }])
    expect(state.panes[0]).toMatchObject({ agent: 'claude', status: 'blocked' })
    expect(state.machines?.[1]?.status).toBe('offline')
  })
})

it('groups every reported program by status and lifts mixed workspaces', async () => {
  const { spaceRows, rowGroup, tabStates } = await import('../shared/spaces')
  const state = coreState([
    terminal('t1', { cwd: '/workspace/delta', agent: 'delta-worker', status: { state: 'working' } }),
    terminal('t2', { cwd: '/workspace/beta', template: 'codex', status: { state: 'idle' } }),
    terminal('t3', { cwd: '/workspace/beta', status: { state: 'working' } }),
    terminal('t4', { cwd: '/workspace/gamma' }),
    terminal('t5', { cwd: '/workspace/epsilon', template: 'claude' }),
    terminal('t6', { cwd: '/workspace/alpha', status: { state: 'idle' } }),
    terminal('t7', { cwd: '/workspace/zeta', status: { state: 'blocked' } }),
  ], [])
  expect(state.panes[0]?.agent).toBe('delta-worker')
  const rows = spaceRows(state)
  expect(rows.map(rowGroup)).toEqual(['working', 'working', 'unknown', 'unknown', 'ready', 'blocked'])
  expect(coreRowCounts(rows)).toEqual({ working: 2, blocked: 1, ready: 3 })
  expect(rows[1]?.lead.coreAddress).toBe('t3')
  expect(tabStates(rows[1]!)).toEqual(['idle', 'working'])
})

it('lists three agents of one folder as three rows counted 1/1/1', async () => {
  const { spaceRows } = await import('../shared/spaces')
  const { individualAgentRows } = await import('../app/utils/homeAgentRows')
  const state = coreState([
    terminal('a1', { cwd: '/workspace/same', template: 'claude', status: { state: 'working' } }),
    terminal('a2', { cwd: '/workspace/same', template: 'claude', status: { state: 'blocked' } }),
    terminal('a3', { cwd: '/workspace/same', template: 'codex', status: { state: 'idle' } }),
  ], [])
  const rows = individualAgentRows(spaceRows(state))
  expect(rows).toHaveLength(3)
  expect(coreRowCounts(rows)).toEqual({ working: 1, blocked: 1, ready: 1 })
})

it('recognizes a Devin command when core supplies no agent field', () => {
  expect(coreState([terminal('t1', { argv: ['/opt/bin/devin', '-r', 'session-a'] })], []).panes[0]?.agent).toBe('devin')
})

it('keeps a Codex stopped by its update as a Codex waiting for a restart, and tells an installing one', () => {
  const state = coreState([
    terminal('t1', { labels: { 'wherdr.codex-updated': '1' } }),
    terminal('t2', { template: 'codex', title: 'Installing Codex 0.167.0', status: { state: 'idle' } }),
    terminal('t3', { agent: 'codex', labels: { 'wherdr.codex-updated': '1' }, status: { state: 'idle' } }),
  ], [])
  expect(state.panes.map(p => [p.agent, p.status, p.stopped?.reason ?? null, p.installing ?? false])).toEqual([
    ['codex', 'blocked', 'update', false], ['codex', 'idle', null, true], ['codex', 'idle', null, false],
  ])
})

it('masks credentials a terminal or document name carries', () => {
  const state = coreState([
    terminal('t1', { name: 'HTTPS_PROXY=http://user1:secre7@10.0.0.1:3128' }),
    terminal('t2', { title: 'postgres://alice:p%40ss@db.acme/app' }),
    terminal('t3', { name: 'git@github.com:acme/shop.git' }),
    terminal('t4', {}),
  ], [], {
    '': { spaces: [{ id: 's1', name: 'http://user1:secre7@proxy.local', folder: '/srv/app',
      tabs: [{ id: 'b1', name: 'socks5://u2:p2@10.0.0.2:1080', root: { terminal: 't4' } }] }] },
  })
  const [env, db, git, doc] = state.panes
  expect(env?.name).toBe('HTTPS_PROXY=http://…@10.0.0.1:3128')
  expect(env?.tabLabel).toBe('HTTPS_PROXY=http://…@10.0.0.1:3128')
  expect(db?.title).toBe('postgres://…@db.acme/app')
  expect(git?.name).toBe('git@github.com:acme/shop.git')
  // A terminal the herdr-app document places keeps the doc's space and
  // tab names — masked the same way.
  expect(doc?.tabLabel).toBe('socks5://…@10.0.0.2:1080')
  expect(state.workspaces.find(w => w.id === doc?.workspace)?.label).toBe('http://…@proxy.local')
})
