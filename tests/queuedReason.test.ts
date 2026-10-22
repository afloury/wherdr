import { describe, expect, it } from 'vitest'
import { queueReason, canClearQueued } from '../app/utils/queuedReason'
import { publicEntry } from '../server/utils/queued'
import type { Pane } from '../shared/types'
const idle = { agent: 'claude', status: 'idle' } as Pane

describe('queued message blockers', () => {
  it('shows the detected draft and allows clearing only at rest', () => {
    expect(publicEntry({ id: 'q', text: 'hello', at: 1, held: true, busy: true, inputText: 'ns' })).toMatchObject({ reason: 'busy', inputText: 'ns' })
    expect(queueReason(idle, { reason: 'busy' })).toBe('busy')
    expect(queueReason({ ...idle, status: 'blocked', menu: {} } as Pane, { reason: 'busy' })).toBe('dialog')
    expect(canClearQueued(idle, { reason: 'busy', state: 'held' })).toBe(true)
    for (const status of ['working', 'blocked', 'unknown']) expect(canClearQueued({ ...idle, status } as Pane, { reason: 'busy', state: 'held' })).toBe(false)
  })
  it('prioritizes current blockers over stale busy reasons', () => {
    for (const [patch, reason] of [[{ stopped: true }, 'stopped'], [{ status: 'working' }, 'working'], [{ status: 'blocked' }, 'question'], [{ menu: {} }, 'dialog'], [{ pendingPrompt: true }, 'starting']] as const) {
      expect(queueReason({ ...idle, ...patch } as Pane, { reason: 'busy' })).toBe(reason)
      expect(canClearQueued({ ...idle, ...patch } as Pane, { reason: 'busy', state: 'held' })).toBe(false)
    }
  })
})
