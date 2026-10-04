import { describe, expect, it } from 'vitest'
import { newestThought } from '../app/utils/reasoningReveal'

describe('omp thought reveal', () => {
  it('animates only the newest new thought in a refreshed tail', () => {
    const seen = new Set(['earlier'])
    expect(newestThought(seen, ['earlier', 'first', 'last'], true)).toBe('last')
    expect(newestThought(seen, ['earlier', 'first', 'last'], true)).toBeNull()
  })

  it('marks the initial history as seen without animating it', () => {
    const seen = new Set<string>()
    expect(newestThought(seen, ['old'], false)).toBeNull()
    expect(newestThought(seen, ['old', 'new'], true)).toBe('new')
  })
})
