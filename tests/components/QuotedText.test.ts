import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import QuotedText from '~/components/QuotedText.vue'
import UserText from '~/components/UserText.vue'

// A sent message: each "↳ … —" line (shared/reference.ts) is a quote, the
// answer below it stays the user's text.
const text = [
  '↳ Quote message 11:35 : Three things to note: the cache… —', 'Noted — thanks.',
  '',
  '↳ Quote decision 11:37 #3 : Publish the release notes? —', 'No',
  '↳ Décision : Publier le thème ? —', 'Oui, lundi.',
  '> an old quote', 'Its answer',
  '↳ not a reference —',
].join('\n')
const quotes = (w: { findAll: (s: string) => { attributes: (n: string) => string | undefined, find: (s: string) => { exists: () => boolean, text: () => string } }[] }) =>
  w.findAll('.msg-ref').map(q => [q.attributes('data-kind'), q.find('.msg-ref-meta').exists() ? q.find('.msg-ref-meta').text() : '', q.find('.msg-ref-text').text()])

describe('QuotedText', () => {
  it('shows each reference as a quote: what it names, then its excerpt', async () => {
    const w = await mountSuspended(QuotedText, { props: { text } })
    expect(quotes(w)).toEqual([
      ['message', '11:35', 'Three things to note: the cache…'],
      ['decision', '11:37 · #3', 'Publish the release notes?'],
      ['task', 'Décision', 'Publier le thème ?'],
    ])
    // The words of the syntax are drawn, not repeated; the rest is the user's text.
    expect(w.text()).not.toContain('Quote message')
    expect(w.text()).toContain('Noted — thanks.')
    expect(w.text()).toContain('↳ not a reference —')
    // A run of "> " lines, as quotes were written before.
    expect(w.findAll('.msg-q').map(q => q.text())).toEqual(['an old quote'])
    w.unmount()
  })

  it('keeps the blank lines of a plain message, not those that only set a quote apart', async () => {
    const plain = 'First paragraph.\n\nSecond paragraph.'
    const a = await mountSuspended(UserText, { props: { text: plain } })
    expect(a.find('.msg-fold').element.textContent).toBe(plain)
    a.unmount()
    const b = await mountSuspended(UserText, { props: { text: '↳ Quote point 11:37 : First? —\n\n↳ Quote point 11:37 : Second? —\nYes\n\nAnd a last word.' } })
    expect(b.find('.msg-fold').element.textContent).toBe('↳11:37First?↳11:37Second?Yes\n\nAnd a last word.')
    b.unmount()
  })

  it('a quote of the conversation is a button that shows the message it names; a task is not', async () => {
    const gotoRef = vi.fn()
    const w = await mountSuspended(QuotedText, { props: { text }, global: { provide: { gotoRef } } })
    const [message, decision, task] = w.findAll('.msg-ref')
    expect([message!.element.tagName, decision!.element.tagName, task!.element.tagName]).toEqual(['BUTTON', 'BUTTON', 'SPAN'])
    expect(message!.attributes('aria-label')).toBe('Show original message: Three things to note: the cache…')
    await decision!.trigger('click')
    expect(gotoRef).toHaveBeenCalledOnce()
    expect(gotoRef.mock.calls[0]![0]).toMatchObject({ kind: 'decision', time: '11:37', n: '3', excerpt: 'Publish the release notes?' })
    await task!.trigger('click')
    expect(gotoRef).toHaveBeenCalledOnce()
    w.unmount()
  })

  it('without a conversation around it (a preview), a quote is plain markup', async () => {
    const w = await mountSuspended(QuotedText, { props: { text: '↳ Quote point 11:37 : First? —\nYes' } })
    expect(w.find('.msg-ref').element.tagName).toBe('SPAN')
    w.unmount()
  })
})
