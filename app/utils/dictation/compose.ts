// What the composer does with dictation: where the text lands, the take's
// wave drawn in characters, its clock, and the per-device engine choice.
import type { DictationEngineId } from './engine'

// Settings › Conversation › Dictation: off by default, kept on this device (a
// model installed on the phone does not exist on the computer).
export type DictationChoice = 'off' | DictationEngineId
export const DICTATION_KEY = 'dictationEngine'

// A choice whose engine is gone (an older build, a removed engine) reads as off.
export function parseDictationChoice(raw: string | null | undefined, present: readonly string[]): DictationChoice {
  return raw && present.includes(raw) ? raw as DictationEngineId : 'off'
}

// The dictated text at the caret when the field has the focus, else at the
// end; one space keeps it apart from its neighbours. `caret` is where the
// cursor goes after it.
export function insertDictated(draft: string, add: string, sel?: { start: number, end: number } | null): { text: string, caret: number } {
  const start = sel ? Math.min(sel.start, draft.length) : draft.length
  const end = sel ? Math.max(start, Math.min(sel.end, draft.length)) : draft.length
  const before = draft.slice(0, start)
  const after = draft.slice(end)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const tail = after && !/^\s/.test(after) ? ' ' : ''
  const piece = lead + add + tail
  return { text: before + piece + after, caret: before.length + lead.length + add.length }
}

const BARS = '▁▂▃▄▅▆▇█'
export const WAVE_WIDTH = 24

// RMS levels (0…1, newest last) as a line of block characters. Speech sits
// around 0.02–0.2: the square root spreads it over the eight heights.
export function waveText(levels: readonly number[], width = WAVE_WIDTH): string {
  const tail = levels.slice(-width)
  const bars = tail.map(l => BARS[Math.max(0, Math.min(7, Math.floor(Math.sqrt(Math.max(0, l)) * 16)))])
  return BARS[0]!.repeat(width - bars.length) + bars.join('')
}

// 0:07, 1:52.
export function takeClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
