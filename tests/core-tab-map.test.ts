import { describe, expect, it } from 'vitest'
import { paneBoxes } from '../shared/layout'
import { sameTabBody, spaceMapLayout } from '../shared/coreTabMap'
import type { Pane } from '../shared/types'

const pane = (o: Partial<Pane>) => ({ id: 'p', workspace: 'w', machine: '', cwd: '/home/u/app', agent: null, ...o }) as Pane

describe('spaceMapLayout', () => {
  it('gives one box per terminal, inside 0..100', () => {
    for (const n of [1, 2, 3, 5, 9]) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`)
      const boxes = paneBoxes(spaceMapLayout('w', ids))
      expect(boxes.map(b => b.pane)).toEqual(ids)
      for (const b of boxes) {
        expect(b.left + b.width).toBeLessThanOrEqual(100.01)
        expect(b.top + b.height).toBeLessThanOrEqual(100.01)
      }
    }
  })
  it('lays two terminals side by side', () => {
    const [a, b] = paneBoxes(spaceMapLayout('w', ['a', 'b']))
    expect(a!.top).toBe(b!.top)
    expect(b!.left).toBeGreaterThan(a!.left)
  })
  it('survives an empty space', () => {
    expect(paneBoxes(spaceMapLayout('w', []))).toEqual([])
  })
})

describe('sameTabBody', () => {
  it('keeps kind, folder, space and machine', () => {
    expect(sameTabBody(pane({ agent: 'claude', machine: 'abc' }), ['claude'])).toEqual({ machine: 'abc', kind: 'claude', cwd: '/home/u/app', name: '', workspace: 'w' })
  })
  it('a plain terminal or unknown agent stays a shell', () => {
    expect(sameTabBody(pane({}), ['claude'])?.kind).toBe('shell')
    expect(sameTabBody(pane({ agent: 'aider' }), ['claude'])?.kind).toBe('shell')
  })
  it('asks for the sheet without a folder', () => {
    expect(sameTabBody(pane({ cwd: '' }), ['claude'])).toBeNull()
    expect(sameTabBody(undefined, [])).toBeNull()
  })
})
