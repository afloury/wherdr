import { describe, expect, it } from 'vitest'
import { internalBack, isDetailRoute } from '../app/utils/viewHistory'

describe('detail history policy', () => {
  it('recognizes every detail entry point, leaving list and settings routes alone', () => {
    for (const path of ['/a/pane', '/t/tab']) expect(isDetailRoute(path)).toBe(true)
    for (const path of ['/', '/settings', '/setup']) expect(isDetailRoute(path)).toBe(false)
  })
  it('uses only an internal predecessor, otherwise Home is the fallback', () => {
    for (const back of ['/', '/settings?section=about', '/a/pane']) expect(internalBack(back)).toBe(true)
    for (const back of [null, undefined, '', '//example.test', 'https://example.test', 1]) expect(internalBack(back)).toBe(false)
  })
})
