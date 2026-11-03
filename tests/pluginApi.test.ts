// Plugin API additions (apiVersion 1): agents, state and project files (docs/plugins.md).
import { describe, expect, it, vi } from 'vitest'
import { createPluginHost, type HostDeps, type PluginAgent } from '../app/utils/pluginHost'
import { pluginLabels } from '../server/utils/coreCreate'
import { coreState } from '../shared/coreState'
import { coreRouteAllowed } from '../shared/coreRoutes'

const agent = (id: string, labels: Record<string, string> = {}): PluginAgent => ({ id, name: id, agent: 'claude', status: 'idle', labels, folder: '/home/u/app', machine: '' })

function setup(plugin: (w: any) => unknown, extra: Partial<HostDeps> = {}) {
  let list = [agent('a1')]
  const subs = new Set<() => void>()
  const deps: HostDeps = {
    list: async () => [{ id: 'p', name: 'p', version: '1', description: '', main: 'index.js' }],
    load: async () => ({ default: plugin }),
    insertDraft: () => {},
    currentAgent: () => null,
    subscribeNavigate: () => () => {},
    prefs: () => ({ off: [], failed: {} }),
    savePrefs: () => {},
    changed: () => {},
    timeoutMs: 100,
    agents: () => list,
    subscribeAgents: (cb) => { subs.add(cb); return () => subs.delete(cb) },
    ...extra,
  }
  const host = createPluginHost(deps)
  const emit = (next: PluginAgent[]) => { list = next; subs.forEach(cb => cb()) }
  return { host, emit, subs, status: () => host.rows()[0]?.status }
}

describe('plugin API: state', () => {
  it('gives the agents at once, then only when the list changed; unsubscribes', async () => {
    const seen: PluginAgent[][] = []
    let off = () => {}
    const s = setup((w) => { off = w.state.subscribe((a: PluginAgent[]) => seen.push(a)) })
    await s.host.init()
    expect(seen).toHaveLength(1)
    expect(seen[0]![0]).toMatchObject({ id: 'a1', folder: '/home/u/app' })
    s.emit([agent('a1')]) // same list
    expect(seen).toHaveLength(1)
    s.emit([agent('a1'), agent('a2', { 'wherdr.task': 't1' })])
    expect(seen).toHaveLength(2)
    expect(seen[1]![1]!.labels).toEqual({ 'wherdr.task': 't1' })
    off()
    expect(s.subs.size).toBe(0)
  })
  it('disables a plugin whose state callback throws, and stops its subscription', async () => {
    let calls = 0
    const s = setup((w) => { w.state.subscribe(() => { if (++calls > 1) throw new Error('bad cb') }) })
    await s.host.init()
    expect(s.status()).toBe('running')
    s.emit([agent('x')])
    expect(s.status()).toBe('failed')
    expect(s.subs.size).toBe(0)
  })
  it('works without the optional deps: empty list, rejected calls', async () => {
    let api: any
    const s = setup((w) => { api = w }, { agents: undefined, subscribeAgents: undefined, readFile: undefined })
    await s.host.init()
    expect(api.state.agents()).toEqual([])
    await expect(api.files.read('', '/home/u/app/x')).rejects.toThrow(/Not available/)
    await expect(api.agents.start({ folder: '/home/u/app', agent: 'claude' })).rejects.toThrow(/Not available/)
  })
})

describe('plugin API: agents and files', () => {
  it('starts an agent with its labels, opens one, reads and writes files', async () => {
    const startAgent = vi.fn(async () => ({ id: 'w1:p9', name: 'coord', firstMessage: 'sent' as const }))
    const openAgent = vi.fn()
    const readFile = vi.fn(async () => null)
    const writeFile = vi.fn(async () => {})
    let api: any
    const s = setup((w) => { api = w }, { startAgent, openAgent, readFile, writeFile })
    await s.host.init()
    const r = await api.agents.start({ folder: '/home/u/app', agent: 'claude', firstMessage: 'hi', labels: { 'wherdr.role': 'coordinator' } })
    expect(r).toEqual({ id: 'w1:p9', name: 'coord', firstMessage: 'sent' })
    expect(startAgent).toHaveBeenCalledWith(expect.objectContaining({ machine: '', folder: '/home/u/app', agent: 'claude', labels: { 'wherdr.role': 'coordinator' } }))
    api.agents.open('w1:p9')
    expect(openAgent).toHaveBeenCalledWith('w1:p9')
    expect(await api.files.read('', '/home/u/app/.wherdr/tasks.json')).toBeNull()
    await api.files.write('', '/home/u/app/.wherdr/tasks.json', '{}')
    expect(writeFile).toHaveBeenCalledWith('', '/home/u/app/.wherdr/tasks.json', '{}')
    await expect(api.files.write('', '/x', 3)).rejects.toThrow(/Text expected/)
  })
  it('refuses a relative folder, a missing agent and labels outside wherdr.*', async () => {
    let api: any
    const s = setup((w) => { api = w }, { startAgent: vi.fn() })
    await s.host.init()
    await expect(api.agents.start({ folder: 'app', agent: 'claude' })).rejects.toThrow(/absolute/)
    await expect(api.agents.start({ folder: '/home/u/app' })).rejects.toThrow(/agent/)
    await expect(api.agents.start({ folder: '/home/u/app', agent: 'claude', labels: { 'herdr.space': 'x' } })).rejects.toThrow(/wherdr\./)
  })
})

describe('server side', () => {
  it('pluginLabels: wherdr.* keys only, short single-line values, 8 at most', () => {
    expect(pluginLabels(undefined)).toEqual({})
    expect(pluginLabels({ 'wherdr.task': 't1', 'wherdr.project': '/home/u/app' })).toEqual({ 'wherdr.task': 't1', 'wherdr.project': '/home/u/app' })
    for (const bad of [{ 'herdr.space': 'x' }, { 'wherdr-request': 'x' }, { 'wherdr.': 'x' }, { 'wherdr.a': 1 }, { 'wherdr.a': 'x\ny' }, ['x'], 'x',
      Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`wherdr.k${i}`, 'v']))]) {
      expect(() => pluginLabels(bad)).toThrow()
    }
  })
  it('the state carries a terminal\'s wherdr.* labels, and only those', () => {
    const s = coreState([
      { address: 't1', cwd: '/home/u/app', state: 'running', labels: { 'wherdr.task': 't1', 'herdr.space': 'sp1', 'wherdr-request': 'r' } },
      { address: 't2', cwd: '/home/u/app', state: 'running' },
    ], [])
    expect(s.panes[0]!.labels).toEqual({ 'wherdr.task': 't1' })
    expect(s.panes[1]!.labels).toBeUndefined()
  })
  it('core mode answers the two file routes, exactly', () => {
    expect(coreRouteAllowed('/api/plugin-files/read', 'POST')).toBe(true)
    expect(coreRouteAllowed('/api/plugin-files/write', 'POST')).toBe(true)
    expect(coreRouteAllowed('/api/agents', 'POST')).toBe(true)
    expect(coreRouteAllowed('/api/plugin-files', 'POST')).toBe(false)
    expect(coreRouteAllowed('/api/plugin-files/delete', 'POST')).toBe(false)
  })
})
