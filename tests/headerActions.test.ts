// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHeaderActionsMount, hasHeaderActions } from '../app/utils/headerActions'
import { createPluginHost, type WherdrApi } from '../app/utils/pluginHost'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('header-actions mount helper', () => {
  it('mounts into present and future slots, cleans up on removal and dispose', async () => {
    document.body.innerHTML = '<span data-wherdr="header-actions" class="header-actions"></span>'
    const slot = document.querySelector('[data-wherdr="header-actions"]')!
    expect(hasHeaderActions(slot)).toBe(false)

    const mount = createHeaderActionsMount()
    const cleanups: number[] = []
    const dispose = mount((el) => {
      const btn = document.createElement('button')
      btn.className = 'plugin-pill'
      el.append(btn)
      return () => { cleanups.push(1) }
    })
    expect(hasHeaderActions(slot)).toBe(true)
    expect(document.querySelectorAll('.plugin-pill')).toHaveLength(1)

    // A header appearing later gets the widget too; removing it runs that copy's cleanup.
    const later = document.createElement('header')
    later.innerHTML = '<span data-wherdr="header-actions" class="header-actions"></span>'
    document.body.append(later)
    await vi.waitFor(() => expect(document.querySelectorAll('.plugin-pill')).toHaveLength(2))
    later.remove()
    await vi.waitFor(() => expect(cleanups).toHaveLength(1))

    // Disposing unmounts every remaining copy and is idempotent.
    dispose()
    dispose()
    expect(cleanups).toHaveLength(2)
    expect(hasHeaderActions(slot)).toBe(false)
    expect(document.querySelectorAll('.plugin-pill')).toHaveLength(0)
  })

  it('a throwing or rejecting renderer fails only its own plugin', async () => {
    document.body.innerHTML = '<span data-wherdr="header-actions" class="header-actions"></span>'
    let prefs = { off: [] as string[], failed: {} as Record<string, string> }
    const plugins: Record<string, (w: WherdrApi) => void> = {
      syncBad: w => w.mountHeaderAction(() => { throw new Error('sync boom') }),
      asyncBad: w => w.mountHeaderAction(async () => { throw new Error('async boom') }),
      good: w => w.mountHeaderAction((el) => {
        const b = document.createElement('button')
        b.className = 'good-btn'
        el.append(b)
      }),
    }
    const host = createPluginHost({
      list: async () => ({ plugins: Object.keys(plugins).map(id => ({ id, name: id, version: '1', description: '', main: 'index.js' })), enabled: true }),
      load: async i => ({ default: plugins[i.id] }),
      getDraft: () => null, setDraft() {}, insertDraft() {}, focusDraft() {}, currentAgent: () => null,
      subscribeNavigate: () => () => {}, mountHeaderAction: createHeaderActionsMount(),
      prefs: () => prefs, savePrefs: (p) => { prefs = p }, changed: () => {}, timeoutMs: 100,
    })
    await host.init()
    await vi.waitFor(() => expect(host.rows().find(r => r.id === 'asyncBad')?.status).toBe('failed'))
    expect(host.rows().find(r => r.id === 'syncBad')?.status).toBe('failed')
    expect(host.rows().find(r => r.id === 'good')?.status).toBe('running')
    expect(document.querySelectorAll('.good-btn')).toHaveLength(1)
    await host.setCommunity(false)
  })
})
