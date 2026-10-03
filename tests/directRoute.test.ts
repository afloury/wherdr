import { describe, expect, it } from 'vitest'
import { directRoute } from '../app/utils/directRoute'

describe('directRoute', () => {
  it('converts a tab pathname to the hash route used by the app', () => {
    expect(directRoute('/t/w1:t2', '?pane=w1:p3', '')).toBe('/#/t/w1:t2?pane=w1:p3')
    expect(directRoute('/t/w1:t2', '', '#/')).toBe('/#/t/w1:t2')
  })
  it('also accepts a direct pane link', () => {
    expect(directRoute('/a/w1:p1', '', '')).toBe('/#/a/w1:p1')
  })
  it('keeps an existing hash route and drops the deep-link path in front of it', () => {
    expect(directRoute('/a/m1~w2:p1', '?x=1', '#/a/w1:p1')).toBe('/#/a/w1:p1')
  })
  it('leaves unrelated paths alone', () => {
    expect(directRoute('/', '', '')).toBeNull()
    expect(directRoute('/t/', '', '')).toBeNull()
  })
})
