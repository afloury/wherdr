import { describe, expect, it, vi } from 'vitest'
import { createPluginHost, type HostDeps } from '../app/utils/pluginHost'
import { readPrefs, type ClientPluginInfo, type PluginPrefs } from '../shared/clientPlugins'

const info = (id: string): ClientPluginInfo => ({ id, name: id, version: '1', description: '', main: 'index.js' })

function setup(plugins: Record<string, unknown>, prefs: PluginPrefs = { off: [], failed: {} }, enabled = true) {
  let saved = prefs
  // The open conversation's draft as the page wires it: null when no conversation is open.
  let draftText: string | null = 'initial'
  const navs = new Set<(p: string) => void>()
  const insert = vi.fn((t: string) => {
    if (draftText !== null) draftText = draftText && !/\s$/.test(draftText) ? `${draftText} ${t}` : draftText + t
  })
  const focus = vi.fn()
  const deps: HostDeps = {
    list: async () => ({ plugins: Object.keys(plugins).map(info), enabled }),
    load: async i => ({ default: plugins[i.id] }),
    getDraft: () => draftText,
    setDraft: (t) => { if (draftText !== null) draftText = t },
    insertDraft: insert,
    focusDraft: focus,
    currentAgent: () => ({ id: 'w1:p1', agent: 'claude', name: 'demo', machine: null }),
    subscribeNavigate: (cb) => { navs.add(cb); return () => navs.delete(cb) },
    prefs: () => saved,
    savePrefs: (p) => { saved = p },
    changed: () => {},
    timeoutMs: 50,
  }
  const host = createPluginHost(deps)
  return {
    host, deps, insert, focus, navs,
    getDraft: () => draftText,
    setDraftRaw: (v: string | null) => { draftText = v },
    saved: () => saved,
    status: (id: string) => host.rows().find(r => r.id === id)?.status,
  }
}

describe('plugin host', () => {
  it('does nothing without plugins', async () => {
    const s = setup({})
    await s.host.init()
    expect(s.host.rows()).toEqual([])
  })

  it('gives the plugin the wherdr API', async () => {
    let seen: ReturnType<typeof Object> | null = null
    const s = setup({ ok: (w: { draft: { insert: (t: string) => void }, currentAgent: () => unknown, onNavigate: (cb: (p: string) => void) => void }) => {
      w.draft.insert('hello')
      seen = w.currentAgent() as object
      w.onNavigate(p => s.insert(`nav:${p}`))
    } })
    await s.host.init()
    expect(s.status('ok')).toBe('running')
    expect(s.insert).toHaveBeenCalledWith('hello')
    expect(seen).toMatchObject({ id: 'w1:p1', agent: 'claude' })
    s.navs.forEach(cb => cb('/settings'))
    expect(s.insert).toHaveBeenCalledWith('nav:/settings')
  })

  it('disables a plugin that throws, keeps the others', async () => {
    const s = setup({ bad: () => { throw new Error('boom') }, good: () => {} })
    await s.host.init()
    expect(s.status('bad')).toBe('failed')
    expect(s.status('good')).toBe('running')
    expect(s.host.rows().find(r => r.id === 'bad')?.error).toBe('boom')
    expect(s.saved().failed.bad).toBe('boom')
  })

  it('disables a plugin whose callback throws, and stops calling it', async () => {
    const cb = vi.fn(() => { throw new Error('late') })
    const s = setup({ p: (w: { onNavigate: (c: () => void) => void }) => w.onNavigate(cb) })
    await s.host.init()
    s.navs.forEach(f => f('/a'))
    s.navs.forEach(f => f('/b'))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(s.status('p')).toBe('failed')
    expect(s.navs.size).toBe(0)
  })

  it('fails a bundle without a default export, a rejected load and a hang', async () => {
    const s = setup({ none: undefined, slow: () => new Promise(() => {}) })
    await s.host.init()
    expect(s.status('none')).toBe('failed')
    expect(s.status('slow')).toBe('failed')
    expect(s.host.rows().find(r => r.id === 'slow')?.error).toMatch(/timed out/)
  })

  it('does not start a plugin that is off or failed; enabling retries', async () => {
    const run = vi.fn()
    const s = setup({ a: run, b: run }, { off: ['a'], failed: { b: 'earlier' } })
    await s.host.init()
    expect(run).not.toHaveBeenCalled()
    expect([s.status('a'), s.status('b')]).toEqual(['off', 'failed'])
    await s.host.setEnabled('b', true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(s.status('b')).toBe('running')
    expect(s.saved().failed.b).toBeUndefined()
    await s.host.setEnabled('b', false)
    expect(s.status('b')).toBe('off')
    expect(s.saved().off).toContain('b')
  })

  it('disabling unsubscribes and calls deactivate', async () => {
    const deactivate = vi.fn()
    const s = setup({ p: { activate: (w: { onNavigate: (c: () => void) => void }) => w.onNavigate(() => {}), deactivate } })
    await s.host.init()
    expect(s.navs.size).toBe(1)
    await s.host.setEnabled('p', false)
    expect(s.navs.size).toBe(0)
    expect(deactivate).toHaveBeenCalled()
  })

  it('loads nothing while Community plugins is off, then starts the wanted ones', async () => {
    const run = vi.fn()
    const s = setup({ a: run, b: run }, { off: ['b'], failed: {} }, false)
    await s.host.init()
    expect(run).not.toHaveBeenCalled()
    expect(s.host.rows().map(r => [r.status, r.wanted])).toEqual([['off', true], ['off', false]])
    await s.host.setEnabled('b', true)
    expect(run).not.toHaveBeenCalled()
    await s.host.setCommunity(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(s.status('a')).toBe('running')
    await s.host.setCommunity(false)
    expect(s.status('a')).toBe('off')
    expect(s.host.rows()[0]!.wanted).toBe(true)
  })

  it('drops a load still pending when Community plugins is turned off', async () => {
    let resolve!: (m: { default: unknown }) => void
    const activate = vi.fn()
    const s = setup({ p: activate })
    const h = createPluginHost({ ...s.deps, load: () => new Promise(r => { resolve = r }) })
    const init = h.init()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await h.setCommunity(false)
    resolve({ default: activate })
    await init
    expect(activate).not.toHaveBeenCalled()
    expect(h.rows()[0]!.status).toBe('off')
  })

  it('gives a plugin that failed a new try once an update changed its commit', async () => {
    let commit = 'a'
    const s = setup({ p: () => { if (commit === 'a') throw new Error('boom') } })
    const h = createPluginHost({ ...s.deps, list: async () => ({ plugins: [{ ...info('p'), source: { repo: 'me/p', ref: '', commit } }], enabled: true }) })
    await h.init()
    expect(h.rows()[0]).toMatchObject({ status: 'failed', error: 'boom' })
    await h.refresh()
    expect(h.rows()[0]!.status).toBe('failed')
    commit = 'b'
    await h.refresh()
    expect(h.rows()[0]).toMatchObject({ status: 'running', error: '' })
  })

  it('survives a failing manifest list', async () => {
    const s = setup({})
    const h = createPluginHost({ ...({ list: async () => { throw new Error('offline') } } as Partial<HostDeps>), insertDraft() {}, currentAgent: () => null, subscribeNavigate: () => () => {}, prefs: s.saved, savePrefs() {}, changed() {}, load: async () => ({}) } as HostDeps)
    await h.init()
    expect(h.rows()).toEqual([])
    expect(h.listError()).toBe('offline')
  })

  it('registration disposers are idempotent, even after the plugin stopped', async () => {
    let offs = 0
    const counted = new Set<(p: string) => void>()
    let first!: () => void
    let second!: () => void
    const s = setup({ p: (w: { onNavigate: (c: (p: string) => void) => () => void }) => {
      first = w.onNavigate(() => {})
      second = w.onNavigate(() => {})
    } })
    const h = createPluginHost({ ...s.deps, subscribeNavigate: (cb) => { counted.add(cb); return () => { offs++; counted.delete(cb) } } })
    await h.init()
    expect(counted.size).toBe(2)
    first()
    first()
    expect(offs).toBe(1)
    expect(counted.size).toBe(1)
    await h.setEnabled('p', false)
    expect(offs).toBe(2)
    expect(counted.size).toBe(0)
    second()
    first()
    expect(offs).toBe(2)
  })

  it('a registration whose teardown throws does not break the others nor deactivate', async () => {
    const deactivate = vi.fn()
    const counted = new Set<(p: string) => void>()
    let n = 0
    const s = setup({
      p: {
        activate: (w: { onNavigate: (c: (p: string) => void) => () => void }) => {
          w.onNavigate(() => {})
          w.onNavigate(() => {})
        },
        deactivate,
      },
    })
    const h = createPluginHost({
      ...s.deps,
      subscribeNavigate: (cb) => {
        counted.add(cb)
        n++
        const mine = n
        return () => { counted.delete(cb); if (mine === 1) throw new Error('teardown boom') }
      },
    })
    await h.init()
    expect(counted.size).toBe(2)
    await h.setEnabled('p', false)
    expect(counted.size).toBe(0)
    expect(deactivate).toHaveBeenCalledTimes(1)
  })

  it('a registration made after the plugin stopped never reaches the page', async () => {
    let release!: () => void
    const s = setup({
      p: (w: { onNavigate: (c: (p: string) => void) => () => void }) => new Promise<void>((resolve) => {
        release = () => { w.onNavigate(() => {}); resolve() }
      }),
    })
    const init = s.host.init()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await s.host.setEnabled('p', false)
    release()
    await init
    expect(s.navs.size).toBe(0)
    expect(s.status('p')).toBe('off')
  })

  it('a stale activation finishing after off-and-on leaves the new run alone', async () => {
    const deactivate = vi.fn()
    const releases: (() => void)[] = []
    const s = setup({
      p: {
        activate: (w: { onNavigate: (c: (p: string) => void) => void }) => new Promise<void>((resolve) => {
          const mine = releases.length + 1
          releases.push(() => { w.onNavigate(() => s.insert(`nav${mine}`)); resolve() })
        }),
        deactivate,
      },
    })
    const init = s.host.init()
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    await s.host.setEnabled('p', false)
    expect(deactivate).toHaveBeenCalledTimes(1)
    const on = s.host.setEnabled('p', true)
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases[0]!()
    releases[1]!()
    await init
    await on
    expect(s.status('p')).toBe('running')
    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(s.navs.size).toBe(1)
    s.insert.mockClear()
    s.navs.forEach(cb => cb('/x'))
    expect(s.insert).toHaveBeenCalledWith('nav2')
  })

  it('fails a plugin that registers a non-function callback', async () => {
    const s = setup({ p: (w: { onNavigate: (c: unknown) => void }) => w.onNavigate(null) })
    await s.host.init()
    expect(s.status('p')).toBe('failed')
    expect(s.host.rows()[0]!.error).toMatch(/expects a function/)
  })

  it('draft.get, draft.set and draft.focus read, fill and focus the draft of the open conversation', async () => {
    type DraftApi = { draft: { get: () => string | null, set: (t: string) => void, insert: (t: string) => void, focus: () => void } }
    let api!: DraftApi
    const s = setup({ p: (w: DraftApi) => { api = w } })
    await s.host.init()
    expect(api.draft.get()).toBe('initial')
    api.draft.set('replaced')
    expect(api.draft.get()).toBe('replaced')
    api.draft.set('')
    expect(api.draft.get()).toBe('')
    api.draft.insert('again')
    expect(api.draft.get()).toBe('again')
    api.draft.focus()
    expect(s.focus).toHaveBeenCalledTimes(1)
    // No conversation open: null reads, no-op writes and focuses.
    s.setDraftRaw(null)
    expect(api.draft.get()).toBeNull()
    api.draft.set('ignored')
    expect(s.getDraft()).toBeNull()
  })
})

describe('plugin prefs', () => {
  it('reads defensively', () => {
    expect(readPrefs(null)).toEqual({ off: [], failed: {} })
    expect(readPrefs('{oops')).toEqual({ off: [], failed: {} })
    expect(readPrefs('{"off":["a",1],"failed":{"b":"x","c":2}}')).toEqual({ off: ['a'], failed: { b: 'x' } })
  })
})
