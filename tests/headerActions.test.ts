// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHeaderActionsMount, hasHeaderActions, registerHeaderActionsSlot } from '../app/utils/headerActions'
import { createPluginHost, type WherdrApi } from '../app/utils/pluginHost'

const cleanupsToRun: (() => void)[] = []
function trackCleanup(fn: () => void) {
  cleanupsToRun.push(fn)
  return () => {
    const i = cleanupsToRun.indexOf(fn)
    if (i >= 0) cleanupsToRun.splice(i, 1)
    fn()
  }
}
function addSlot(parent: Element = document.body) {
  const slot = document.createElement('span')
  slot.dataset.wherdr = 'header-actions'
  slot.className = 'header-actions'
  parent.append(slot)
  return {
    slot,
    unregister: trackCleanup(registerHeaderActionsSlot(slot)),
  }
}

afterEach(() => {
  for (const off of cleanupsToRun.splice(0)) off()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('header-actions mount helper', () => {
  it('mounts into present and later-registered slots without observing the page, and cleans up on unregister and dispose', () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe')
    const querySpy = vi.spyOn(document.body, 'querySelectorAll')
    const first = addSlot()
    expect(hasHeaderActions(first.slot)).toBe(false)

    const mount = createHeaderActionsMount()
    const cleanups: number[] = []
    const rawDispose = mount((el) => {
      const btn = document.createElement('button')
      btn.className = 'plugin-pill'
      el.append(btn)
      return () => { cleanups.push(1) }
    })
    const dispose = trackCleanup(rawDispose)
    expect(hasHeaderActions(first.slot)).toBe(true)
    expect(document.querySelectorAll('.plugin-pill')).toHaveLength(1)
    expect(observeSpy).not.toHaveBeenCalled()
    expect(querySpy).not.toHaveBeenCalled()

    // Unrelated page mutations (such as chat streaming) never scan the DOM.
    const stream = document.createElement('div')
    stream.textContent = 'chunk'
    document.body.append(stream)
    expect(querySpy).not.toHaveBeenCalled()

    // A header slot registering after the plugin mounted gets the widget at once;
    // unregistering it runs that copy's cleanup.
    const later = document.createElement('header')
    document.body.append(later)
    const second = addSlot(later)
    expect(later.querySelectorAll('.plugin-pill')).toHaveLength(1)
    expect(document.querySelectorAll('.plugin-pill')).toHaveLength(2)
    expect(observeSpy).not.toHaveBeenCalled()
    expect(querySpy).not.toHaveBeenCalled()

    second.unregister()
    expect(cleanups).toHaveLength(1)
    expect(hasHeaderActions(second.slot)).toBe(false)
    expect(later.querySelectorAll('.plugin-pill')).toHaveLength(0)

    // Disposing unmounts every remaining copy and is idempotent.
    dispose()
    rawDispose()
    expect(cleanups).toHaveLength(2)
    expect(hasHeaderActions(first.slot)).toBe(false)
    expect(document.querySelectorAll('.plugin-pill')).toHaveLength(0)
  })

  it('disposes late and pending async header mounts when the plugin stops', async () => {
    const first = addSlot()
    let releaseLate!: () => void
    let releaseRender!: (fn: () => void) => void
    const asyncCleanup = vi.fn()
    let prefs = { off: [] as string[], failed: {} as Record<string, string> }
    const plugins: Record<string, (w: WherdrApi) => unknown> = {
      late: w => new Promise<void>((resolve) => {
        releaseLate = () => {
          w.mountHeaderAction((el) => { el.append(document.createElement('button')) })
          resolve()
        }
      }),
      pendingRender: (w) => {
        w.mountHeaderAction(() => new Promise<() => void>((resolve) => {
          releaseRender = resolve
        }))
      },
    }
    const host = createPluginHost({
      list: async () => ({ plugins: Object.keys(plugins).map(id => ({ id, name: id, version: '1', description: '', main: 'index.js' })), enabled: true }),
      load: async i => ({ default: plugins[i.id] }),
      getDraft: () => null, setDraft() {}, insertDraft() {}, focusDraft() {}, currentAgent: () => null,
      subscribeNavigate: () => () => {}, mountHeaderAction: createHeaderActionsMount(),
      prefs: () => prefs, savePrefs: (p) => { prefs = p }, changed: () => {}, timeoutMs: 100,
    })
    const init = host.init()
    await vi.waitFor(() => expect(releaseLate).toBeTypeOf('function'))
    await vi.waitFor(() => expect(releaseRender).toBeTypeOf('function'))

    await host.setEnabled('late', false)
    releaseLate()
    await host.setEnabled('pendingRender', false)
    releaseRender(asyncCleanup)
    await init

    expect(first.slot.querySelectorAll('.header-action')).toHaveLength(0)
    await vi.waitFor(() => expect(asyncCleanup).toHaveBeenCalledTimes(1))
    await host.setCommunity(false)
  })

  it('a throwing or rejecting renderer fails only its own plugin', async () => {
    const first = addSlot()
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
    expect(first.slot.querySelectorAll('.header-action')).toHaveLength(1)
    await host.setCommunity(false)
  })
})
