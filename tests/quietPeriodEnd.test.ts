import { describe, expect, it } from 'vitest'
import { quietPeriodEnd } from '../app/utils/quietPeriodEnd'

const at = (d: number, h: number, m = 0) => new Date(2026, 0, d, h, m).getTime()

describe('quietPeriodEnd', () => {
  it('has no end until turned back on', () => {
    expect(quietPeriodEnd({ until: null }, at(10, 12))).toEqual({ kind: 'manual' })
  })
  it('ends later today', () => {
    expect(quietPeriodEnd({ until: at(10, 13) }, at(10, 12))).toEqual({ kind: 'today', at: at(10, 13) })
  })
  it('ends tomorrow morning', () => {
    expect(quietPeriodEnd({ until: at(11, 8) }, at(10, 23, 30))).toEqual({ kind: 'tomorrow', at: at(11, 8) })
  })
  it('ends this morning when muted after midnight', () => {
    expect(quietPeriodEnd({ until: at(11, 8) }, at(11, 1))).toEqual({ kind: 'today', at: at(11, 8) })
  })
  it('ends on a later day', () => {
    expect(quietPeriodEnd({ until: at(14, 9) }, at(10, 12))).toEqual({ kind: 'later', at: at(14, 9) })
  })
  it('crosses a month end', () => {
    const now = new Date(2026, 0, 31, 22).getTime()
    const until = new Date(2026, 1, 1, 8).getTime()
    expect(quietPeriodEnd({ until }, now).kind).toBe('tomorrow')
  })
})
