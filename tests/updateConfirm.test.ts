// The one-tap Update (useUpdate.ts runSelfUpdate) asks for confirmation
// before anything reaches the server: no POST /api/update while the question
// is open, none after Cancel. The same askConfirm sheet serves the phone and
// the computer, so this covers both layouts.
import { computed, reactive, ref } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#shared/updates', () => ({ updateRunning: () => false }))

let answer: (ok: boolean) => void = () => {}
const askConfirm = vi.fn(() => new Promise<boolean>((r) => { answer = r }))
const api = vi.fn(async () => { throw new Error('stopped by the test') })
let runSelfUpdate: (info: never) => Promise<void>

beforeAll(async () => {
  for (const [k, v] of Object.entries({ ref, computed, reactive, askConfirm, api, tl: (en: string) => en, t: (s: string) => s })) vi.stubGlobal(k, v)
  ;({ runSelfUpdate } = await import('../app/composables/useUpdate') as unknown as { runSelfUpdate: typeof runSelfUpdate })
})
beforeEach(() => { askConfirm.mockClear(); api.mockClear() })

const info = { latest: '9.9.9', current: '1.0.0', mode: 'npm', command: 'npm i -g wherdr', oneTap: true } as never
const tick = () => new Promise(r => setTimeout(r, 0))

describe('one-tap update confirmation', () => {
  it('sends nothing while the question is open, nor after Cancel', async () => {
    const run = runSelfUpdate(info)
    await tick()
    expect(askConfirm).toHaveBeenCalledTimes(1)
    expect(api).not.toHaveBeenCalled()
    answer(false)
    await run
    expect(api).not.toHaveBeenCalled()
  })

  it('posts the update only once confirmed', async () => {
    const run = runSelfUpdate(info)
    await tick()
    answer(true)
    await run
    expect(api).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith('/api/update', { version: '9.9.9' })
  })
})
