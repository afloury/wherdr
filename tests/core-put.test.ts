import { describe, expect, it } from 'vitest'
import { CoreError } from '../server/utils/core'
import { CORE_PUT_MAX, corePut, corePutAttachment, corePutFile } from '../server/utils/corePut'
import type { CoreInputDeps } from '../server/utils/coreInput'
import type { Pane } from '../shared/types'

function deps(reply: (method: string, params: any) => unknown = () => ({ path: '/m/t1.files/x' })) {
  const calls: [string, any, number][] = []
  const panes = [{ id: 'w1:p1', coreAddress: 'box/t1', agent: 'claude' }, { id: 'w1:p2' }] as Pane[]
  const d: CoreInputDeps = {
    call: async (method, params, timeout) => { calls.push([method, params, timeout]); const r = reply(method, params); if (r instanceof Error) throw r; return r as never },
    pane: id => panes.find(p => p.id === id), panes: () => panes, refresh: () => {},
  }
  return { d, calls }
}

describe('terminal.put', () => {
  it('sends base64 to the pane\'s full address and returns the path once', async () => {
    const t = deps()
    expect(await corePut(t.d, 'w1:p1', 'a.png', Buffer.from('hi'))).toBe('/m/t1.files/x')
    expect(t.calls).toEqual([['terminal.put', { terminal: 'box/t1', name: 'a.png', data: 'aGk=' }, 60000]])
  })
  it('refuses unknown panes, empty data and more than 8 MB with a clear message', async () => {
    const t = deps()
    await expect(corePut(t.d, 'nope', 'a', Buffer.from('x'))).rejects.toMatchObject({ code: 'bad_pane' })
    await expect(corePut(t.d, 'w1:p2', 'a', Buffer.from('x'))).rejects.toMatchObject({ code: 'bad_pane' })
    await expect(corePut(t.d, 'w1:p1', 'a', Buffer.alloc(0))).rejects.toMatchObject({ code: 'empty' })
    await expect(corePut(t.d, 'w1:p1', 'a', Buffer.alloc(CORE_PUT_MAX + 1))).rejects.toMatchObject({ code: 'too_large', message: 'File too large for herdr-core (8 MB max)' })
    expect(t.calls).toHaveLength(0)
  })
  it('maps core failures without retrying', async () => {
    const t = deps(() => new CoreError('unreachable', 'x'))
    await expect(corePut(t.d, 'w1:p1', 'a', Buffer.from('x'))).rejects.toMatchObject({ code: 'unreachable' })
    expect(t.calls).toHaveLength(1)
  })
  it('keeps the checks of attachments and the safe extension of pasted files', async () => {
    const t = deps()
    const r = await corePutAttachment(t.d, 'w1:p1', 'notes.md', Buffer.from('# hi'))
    expect(r).toMatchObject({ path: '/m/t1.files/x', kind: 'text', ref: '@/m/t1.files/x' })
    expect(r.name).toMatch(/-notes\.md$/)
    await expect(corePutAttachment(t.d, 'w1:p1', 'a.zip', Buffer.from('PK'))).rejects.toMatchObject({ code: 'unsupported' })
    const f = await corePutFile(t.d, 'w1:p1', 'png', Buffer.from('x'))
    expect(f.name).toMatch(/\.png$/)
  })
})
