import { describe, expect, it } from 'vitest'
import { BOARD_DONE_KEY, DONE_LATEST, boardCell, boardDoneShown, boardDoneStored, boardGroups, boardPhoneColumn } from '../app/utils/boardDone'

describe('Done on the Board', () => {
  it('is hidden by default: four columns, the work in progress', () => {
    // Nothing stored yet (first visit, storage unavailable or cleared).
    for (const stored of [null, undefined, '', '0', 'yes', 'true']) expect(boardDoneShown(stored)).toBe(false)
    expect(boardGroups(false)).toEqual(['needs', 'ready', 'working', 'todo'])
  })

  it('the toggle adds Done as the last column, and the choice is kept on the device', () => {
    expect(BOARD_DONE_KEY).toBe('boardDone')
    expect(boardDoneShown(boardDoneStored(true))).toBe(true)
    expect(boardGroups(boardDoneShown(boardDoneStored(true)))).toEqual(['needs', 'ready', 'working', 'todo', 'done'])
    // Hidden again: stored as such, not forgotten (the default could change).
    expect(boardDoneStored(false)).toBe('0')
    expect(boardGroups(boardDoneShown(boardDoneStored(false)))).not.toContain('done')
  })

  it('on a phone, the Done tab falls back to the first one while Done is hidden', () => {
    expect(boardPhoneColumn('done', false)).toBe('needs')
    expect(boardPhoneColumn('done', true)).toBe('done')
    expect(boardPhoneColumn('working', false)).toBe('working')
  })

  it('shown, Done keeps the latest few, then says how many more', () => {
    const done = Array.from({ length: 12 }, (_, i) => `t${i}`)
    expect(DONE_LATEST).toBe(5)
    expect(boardCell('done', done, false, DONE_LATEST)).toEqual({ cards: done.slice(0, 5), hidden: 7 })
    expect(boardCell('done', done, true, DONE_LATEST)).toEqual({ cards: done, hidden: 0 })
    expect(boardCell('done', done.slice(0, 3), false, DONE_LATEST)).toEqual({ cards: done.slice(0, 3), hidden: 0 })
    // Other groups are never cut.
    expect(boardCell('todo', done, false, DONE_LATEST)).toEqual({ cards: done, hidden: 0 })
  })
})
