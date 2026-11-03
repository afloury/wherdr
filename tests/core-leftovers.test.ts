import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('core mode: state is not rebuilt from the empty legacy machines', () => {
  vi.setConfig({ testTimeout: 30000 })
  beforeEach(() => { vi.resetModules(); process.env.WHERDR_BACKEND = 'core' })
  afterEach(() => { vi.restoreAllMocks(); delete process.env.WHERDR_BACKEND })

  it('keeps the core state after READY_MAX_MS', async () => {
    const good = { ok: true, workspaces: [{ id: 'w1', label: 'w' }], tabs: [], panes: [] }
    vi.doMock('../server/utils/readCoreState', () => ({ readCoreState: async () => good }))
    // These come from Nitro auto-imports in production.
    Object.assign(globalThis, { coreScreens: () => ({ enrich: async () => {} }), coreTranscriptsOf: () => ({ observe: () => {}, forget: () => {} }), corePreviews: () => ({ apply: () => {} }) })
    // The module schedules its rebuild at load: capture it and fire it by hand.
    const real = globalThis.setTimeout
    const late: Array<() => void> = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...a: unknown[]) => {
      if (ms === 20100) { late.push(fn); return 0 as never }
      return real(fn, ms, ...a)
    }) as never)
    const s = await import('../server/utils/state')
    expect(late).toHaveLength(1)
    await s.poll()
    expect(s.getState().ok).toBe(true)
    late[0]!()
    expect(s.getState().ok).toBe(true)
    expect(s.getState().workspaces).toHaveLength(1)
  })
})

describe('core mode: no Board read for a notification', () => {
  vi.setConfig({ testTimeout: 30000 })
  afterEach(() => { delete process.env.WHERDR_BACKEND; vi.resetModules() })
  it('does not call readBoardLinks', async () => {
    vi.resetModules()
    process.env.WHERDR_BACKEND = 'core'
    const read = vi.fn(async () => null)
    vi.doMock('../server/utils/boardLinks', () => ({ readBoardLinks: read }))
    const { notificationAllowed } = await import('../server/utils/notificationRules')
    await notificationAllowed('needs-you' as never, { workspaces: [] }, { id: 'p1', workspace: 'w1' }).catch(() => {})
    expect(read).not.toHaveBeenCalled()
  })
})

describe('core mode: pasted texts are kept', () => {
  it('coreSend keeps the pasted blocks of a message but not of a slash command', async () => {
    vi.resetModules()
    const keep = vi.fn()
    vi.doMock('../server/utils/pastes', () => ({ keepPastes: keep }))
    const { coreSend } = await import('../server/utils/coreInput')
    const d = { call: async () => ({ started: true }), pane: () => ({ id: 't1', coreAddress: 'm/t1' }), panes: () => [], refresh: () => {} } as never
    await coreSend(d, { pane_id: 't1', text: 'see this', pastes: [[4, 8]] } as never)
    await coreSend(d, { pane_id: 't1', text: '/clear', pastes: [] } as never)
    expect(keep).toHaveBeenCalledTimes(1)
    expect(keep).toHaveBeenCalledWith('see this', [[4, 8]])
  })
})
