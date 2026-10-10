import { afterEach, describe, expect, it, vi } from 'vitest'
import { withPaneLock } from '../server/utils/guardedSend'
import { HerdrError } from '../server/utils/herdr'
import { viaPrompt } from '../shared/sendRoute'
import { updatePrompt } from '../shared/selfUpdate'
import type { Pane } from '../shared/types'

afterEach(() => vi.unstubAllGlobals())

function setup() {
  const pane = { id: 'w1:p1', agent: 'codex', status: 'blocked', stopped: { reason: 'update' },
    prompt: updatePrompt({ argv: ['codex'], session: null, conversation: 'empty' }) } as Pane
  const write = vi.fn()
  const queue = vi.fn((id, text, options) => ({ id: 'queued', paneId: id, text, ...options }))
  vi.stubGlobal('defineApi', (handler: unknown) => handler)
  vi.stubGlobal('PANE_RE', /^w1:p1$/)
  vi.stubGlobal('HerdrError', HerdrError)
  vi.stubGlobal('findPane', () => pane)
  vi.stubGlobal('restarting', () => false)
  vi.stubGlobal('withPaneLock', withPaneLock)
  vi.stubGlobal('herdr', write)
  vi.stubGlobal('addQueued', queue)
  vi.stubGlobal('poll', () => {})
  vi.stubGlobal('closePanel', write)
  return { pane, write, queue }
}

// These import and execute the actual endpoints, including their pane lock.
describe('messages to a stopped Codex', () => {
  it('routes the synthetic Project panel target through /api/prompt', () => {
    const { pane } = setup()
    expect(viaPrompt(pane)).toBe(true)
    expect(viaPrompt({ ...pane, stopped: undefined })).toBe(true)
  })
  it.each(['input', 'prompt'])('holds a Project message in /api/%s without writing', async route => {
    const s = setup()
    const { default: handler } = await import(`../server/api/${route}.post.ts`)
    const result = await handler({}, { pane_id: s.pane.id, text: 'Confirm: tested, it works', keys: ['enter'] })
    expect(result.queued).toMatchObject({ held: true, text: 'Confirm: tested, it works' })
    expect(s.write).not.toHaveBeenCalled()
    expect(s.queue).toHaveBeenCalledOnce()
  })
  it.each(['input', 'prompt'])('checks stopped state after waiting for the %s lock', async route => {
    const s = setup()
    s.pane.stopped = undefined
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const owner = withPaneLock(s.pane.id, async () => { ready.resolve(); await release.promise })
    await ready.promise
    const { default: handler } = await import(`../server/api/${route}.post.ts`)
    const response = handler({} as never, { pane_id: s.pane.id, text: 'Send to coordinator', keys: ['enter'] })
    s.pane.stopped = { reason: 'update' }
    release.resolve()
    await owner
    expect(await response).toMatchObject({ queued: { held: true } })
    expect(s.write).not.toHaveBeenCalled()
  })
  it.each([{ keys: ['enter'] }, { text: '/exit', keys: ['enter'] }, { text: 'draft' }, { text: 'message', keys: ['ctrl+c', 'enter'] }])('rejects raw input %j', async input => {
    const s = setup()
    const { default: handler } = await import('../server/api/input.post')
    await expect(handler({} as never, { pane_id: s.pane.id, ...input })).rejects.toMatchObject({ code: 'stale' })
    expect(s.write).not.toHaveBeenCalled()
    expect(s.queue).not.toHaveBeenCalled()
  })
  it('holds immediately during a long restart without waiting for its write lock', async () => {
    const s = setup()
    vi.stubGlobal('restarting', () => true)
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const owner = withPaneLock(s.pane.id, async () => { ready.resolve(); await release.promise })
    await ready.promise
    try {
      const { default: handler } = await import('../server/api/prompt.post')
      expect(await handler({} as never, { pane_id: s.pane.id, text: 'Wait for restart' })).toMatchObject({ queued: { held: true } })
      expect(s.write).not.toHaveBeenCalled()
    } finally { release.resolve(); await owner }
  })
  it('preserves normal raw text and Enter for a live question', async () => {
    const s = setup()
    s.pane.stopped = undefined
    const { default: handler } = await import('../server/api/input.post')
    await handler({} as never, { pane_id: s.pane.id, text: 'My answer', keys: ['enter'] })
    expect(s.write.mock.calls).toEqual([
      ['pane.send_input', { pane_id: s.pane.id, text: 'My answer' }],
      ['pane.send_input', { pane_id: s.pane.id, keys: ['enter'] }],
    ])
  })
  it('rejects slash commands through /api/prompt', async () => {
    const s = setup()
    const { default: handler } = await import('../server/api/prompt.post')
    await expect(handler({} as never, { pane_id: s.pane.id, text: '/exit' })).rejects.toMatchObject({ code: 'stale' })
    expect(s.write).not.toHaveBeenCalled()
  })
})
