import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findReplyOrigin, MARKER_MAX, parseReply, replyMarker, replyTarget, truncateMiddle, withReply } from '../shared/replyQuote'
import { queuedPhases } from '../shared/queuedPhase'
import { createSelectionSettler, lastLineRect, trimmedEnd, selectionReplyPos, SETTLE_KEYBOARD, SETTLE_POINTER, SETTLE_SCROLL, SETTLE_TOUCH } from '../app/utils/selectionReply'
import type { ClaudeScreen } from '../shared/types'

const MSG = 'Je propose deux options : garder le cache actuel, ou passer à IndexedDB avec une purge au démarrage.'
const screen = (sent: string | null, queued: string[] = []) => ({ shell: null, sent, queued }) as ClaudeScreen

describe('replying to a whole message', () => {
  it('the button under the message quotes the start of the message', () => {
    const r = replyTarget(MSG, '14:32', 'fr')
    expect(r.excerpt.startsWith('Je propose deux options')).toBe(true)
  })
  const view = { width: 1440, top: 100, bottom: 900 }
  const btn = { width: 100, height: 32 }
  it('button just after the last character, centered on its line', () => {
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 100, right: 400 }, btn, view, false)).toEqual({ top: 294, left: 406 })
  })
  it('last line = last non-empty rectangle', () => {
    const rects = [{ top: 280, bottom: 300, left: 100, right: 900 }, { top: 300, bottom: 320, left: 100, right: 260 }, { top: 320, bottom: 320, left: 100, right: 100 }]
    expect(lastLineRect(rects)).toEqual(rects[1])
    expect(lastLineRect([])).toBeNull()
  })
  it('trimmed end: final newline of a triple click', () => {
    expect(trimmedEnd(['Dernier paragraphe complet.\n'])).toEqual({ index: 0, offset: 27 })
  })
  it('trimmed end: blank nodes after the paragraph (footer, next message trimmed)', () => {
    expect(trimmedEnd(['Début ', 'fin du message.', '\n\n', '  '])).toEqual({ index: 1, offset: 15 })
    expect(trimmedEnd(['\n', ' '])).toBeNull()
    expect(trimmedEnd([])).toBeNull()
  })
  it('trimmed end: whole final emoji', () => {
    expect(trimmedEnd(['ok 👍\n'])).toEqual({ index: 0, offset: 5 })
  })
  it('empty trailing rectangles ignored', () => {
    const rects = [{ top: 300, bottom: 320, left: 100, right: 500 }, { top: 320, bottom: 340, left: 100, right: 100 }, { top: 340, bottom: 340, left: 0, right: 0 }]
    expect(lastLineRect(rects)).toEqual(rects[0])
  })
  it('overflow on the right: below the end of the line, aligned on the last word', () => {
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 1200, right: 1400 }, btn, view, false)).toEqual({ top: 326, left: 1300 })
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 1300, right: 1440 }, btn, view, false)!.left).toBe(1332)
  })
  it('phone: below the line, below the handle, never above', () => {
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 0, right: 40 }, btn, { width: 390, top: 0, bottom: 800 }, true)).toEqual({ top: 342, left: 8 })
    expect(selectionReplyPos({ top: 760, bottom: 780, left: 0, right: 200 }, btn, { width: 390, top: 0, bottom: 800 }, true)!.top).toBe(760)
  })
  it('no room below: above; off screen: no button', () => {
    expect(selectionReplyPos({ top: 860, bottom: 880, left: 1200, right: 1400 }, btn, view, false)!.top).toBe(822)
    expect(selectionReplyPos({ top: 950, bottom: 970, left: 1, right: 2 }, btn, view, false)).toBeNull()
  })
  it('reversed selection: same end rectangle, same place', () => {
    // getClientRects() follows document order whatever the drag direction.
    const rects = [{ top: 280, bottom: 300, left: 300, right: 900 }, { top: 300, bottom: 320, left: 100, right: 400 }]
    expect(selectionReplyPos(lastLineRect(rects)!, btn, view, false)).toEqual({ top: 294, left: 406 })
  })
})

describe('replying to a selection: appearance', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const make = (touch = false) => {
    const show = vi.fn(), hide = vi.fn()
    return { show, hide, s: createSelectionSettler({ show, hide, touch: () => touch }) }
  }
  it('never while dragging, after release + delay', () => {
    const { show, s } = make()
    s.down(); s.change(); s.change()
    vi.advanceTimersByTime(1000)
    expect(show).not.toHaveBeenCalled()
    s.up()
    vi.advanceTimersByTime(SETTLE_POINTER - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
  })
  it('keyboard: after a delay without change', () => {
    const { show, hide, s } = make()
    s.change(); vi.advanceTimersByTime(200); s.change()
    expect(hide).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(SETTLE_KEYBOARD - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
  })
  it('spurious event without change: no flicker', () => {
    const { hide, s } = make()
    s.change(true)
    expect(hide).not.toHaveBeenCalled()
  })
  it('phone: waits for the handle adjustment to end', () => {
    const { show, s } = make(true)
    s.change(); vi.advanceTimersByTime(SETTLE_TOUCH - 50); s.change()
    vi.advanceTimersByTime(SETTLE_TOUCH - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
  })
  it('scrolling: hidden, then shown again once stopped', () => {
    const { show, hide, s } = make()
    s.scroll(); vi.advanceTimersByTime(100); s.scroll()
    expect(hide).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(SETTLE_SCROLL)
    expect(show).toHaveBeenCalledOnce()
  })
})

describe('queue: sending order', () => {
  it('the 2nd does not become "sent" before the 1st', () => {
    // Claude took both messages; the screen only shows the last one sent.
    expect(queuedPhases(['Premier message assez long pour compter', 'Second message'], screen('Second message'))).toEqual(['sent', 'sent'])
  })
  it('an older one still in the queue holds back the following ones', () => {
    expect(queuedPhases(['Premier', 'Second'], screen('Second', ['Premier']))).toEqual(['queued', 'queued'])
  })
  it('normal order unchanged', () => {
    expect(queuedPhases(['Premier', 'Second'], screen('Premier', ['Second']))).toEqual(['sent', 'queued'])
    expect(queuedPhases(['Premier', 'Second'], null)).toEqual(['queued', 'queued'])
  })
})

describe('queue: quote', () => {
  it('la bulle en file garde sa citation', () => {
    const msg = withReply(replyTarget('Option A ?', '14:32', 'fr'), 'Yes please', 'fr')
    expect(parseReply(msg)).toEqual({ reply: { time: '14:32', excerpt: 'Option A ?' }, body: 'Yes please' })
  })
})

describe('long passage: start and end', () => {
  const long = 'Premier point important sur le cache actuel, puis une longue explication intermédiaire qui ne tient pas du tout dans le repère, et enfin la conclusion qui recommande IndexedDB.'
  it('"start… end" excerpt, cut at words, balanced', () => {
    const excerpt = truncateMiddle(long, 80)
    expect(excerpt.length).toBeLessThanOrEqual(80)
    expect(excerpt).toMatch(/^\S.*\S… \S.*\S$/)
    const [a, b] = excerpt.split('… ')
    expect(long.startsWith(a!)).toBe(true)
    expect(long.endsWith(b!)).toBe(true)
    expect(Math.abs(a!.length - b!.length)).toBeLessThan(15)
  })
  it('history: passage markers of older versions still find their message', () => {
    const list = [{ time: '14:32', text: MSG }, { time: '14:32', text: long }]
    const marker = replyMarker({ time: '14:32', excerpt: truncateMiddle(long, 80) }, 'fr')
    expect(marker.length).toBeLessThanOrEqual(MARKER_MAX)
    const p = parseReply(`${marker}\n\nok`)!
    expect(p.body).toBe('ok')
    expect(findReplyOrigin(list, p.reply)).toBe(list[1])
    expect(findReplyOrigin(list, { time: '14:32', excerpt: 'Premier point important sur le cache…' })).toBe(list[1])
  })
})
