import { describe, expect, it, vi } from 'vitest'
import { boardTaskHits } from '../shared/searchScope'
import type { TaskHit } from '../shared/taskSearch'

const hit = { id: '1' } as unknown as TaskHit

describe('boardTaskHits', () => {
  it('never reads the Board in core mode', async () => {
    const read = vi.fn(async () => [hit])
    expect(await boardTaskHits(true, read)).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })
  it('returns the hits otherwise, and [] on failure', async () => {
    expect(await boardTaskHits(false, async () => [hit])).toEqual([hit])
    expect(await boardTaskHits(false, async () => { throw new Error('x') })).toEqual([])
  })
})
