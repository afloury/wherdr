import { describe, expect, it } from 'vitest'
import { restoredScrollTop, saveReadingPosition } from '../app/utils/readingPosition'

const box = (scrollTop: number, scrollHeight = 5000, clientHeight = 800) => ({ scrollTop, scrollHeight, clientHeight })

describe('position de lecture', () => {
  it('rouvre la conversation au même endroit, mesuré depuis le bas', () => {
    saveReadingPosition('p1', 'a.jsonl', box(3000))
    expect(restoredScrollTop('p1', 'a.jsonl', 5000)).toBe(3000)
    // Tranches plus anciennes pas encore rechargées : la même fin reste à l'écran.
    saveReadingPosition('p1', 'a.jsonl', box(7000, 9000))
    expect(restoredScrollTop('p1', 'a.jsonl', 5000)).toBe(3000)
    // Position dans une tranche absente : en haut (la suite se recharge en remontant).
    saveReadingPosition('p1', 'a.jsonl', box(1000, 9000))
    expect(restoredScrollTop('p1', 'a.jsonl', 5000)).toBe(0)
  })
  it('reste en bas quand on y était', () => {
    saveReadingPosition('p2', 'a.jsonl', box(4150))
    expect(restoredScrollTop('p2', 'a.jsonl', 5000)).toBeNull()
  })
  it('ignore une autre session de l’agent (/clear) et un pane inconnu', () => {
    saveReadingPosition('p3', 'a.jsonl', box(1000))
    expect(restoredScrollTop('p3', 'b.jsonl', 5000)).toBeNull()
    expect(restoredScrollTop('inconnu', 'a.jsonl', 5000)).toBeNull()
  })
})
