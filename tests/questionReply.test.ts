import { describe, expect, it } from 'vitest'
import { addQuote, isQuoted, QUOTE_MAX, questionIn, quoteOf, quotesIn, quoteSegments, removeQuote } from '../app/utils/questionReply'

describe('questionIn', () => {
  it('keeps the trailing question sentences of a block', () => {
    expect(questionIn('Shall I push?')).toBe('Shall I push?')
    expect(questionIn('The build is green. Shall I push? Or wait for review?')).toBe('Shall I push? Or wait for review?')
    expect(questionIn('Done. Nothing else to do.')).toBeNull()
    expect(questionIn('Is it done? Yes, it is.')).toBeNull()
  })
  it('joins a question written over several lines', () => {
    expect(questionIn('Can you plug the box in\nover Ethernet, so the copy\ngoes faster?')).toBe('Can you plug the box in over Ethernet, so the copy goes faster?')
  })
  it('understands French spacing and closing marks', () => {
    expect(questionIn('Tu peux brancher la box en Ethernet… ?')).toBe('Tu peux brancher la box en Ethernet… ?')
    expect(questionIn('J’ai fini. On garde « la seconde » ?')).toBe('On garde « la seconde » ?')
    expect(questionIn('Use **v1.2** or the *new* one?**')).toBe('Use **v1.2** or the *new* one?**')
    expect(questionIn('(should I also update the docs?)')).toBe('(should I also update the docs?)')
  })
  it('does not cut on decimals or a question mark mid-sentence', () => {
    expect(questionIn('Bump to 2.5 now?')).toBe('Bump to 2.5 now?')
    expect(questionIn('Why? Because the cache is stale.')).toBeNull()
    expect(questionIn('?')).toBeNull()
  })
  it('in a list item, finds the question even when an explanation follows it', () => {
    const item = 'Can you plug the box in over **Ethernet**? Over Wi-Fi the copy would take 30 hours.'
    expect(questionIn(item)).toBeNull()
    expect(questionIn(item, true)).toBe('Can you plug the box in over **Ethernet**?')
    expect(questionIn('Use A? Or B? Both work. Your call.', true)).toBe('Use A? Or B?')
    expect(questionIn('Nothing to ask here.', true)).toBeNull()
  })
})

describe('quoting in the draft', () => {
  it('stacks quotes in order, each followed by its answer', () => {
    let draft = addQuote('', 'Can you plug the box in over Ethernet?')!
    expect(draft).toBe('> Can you plug the box in over Ethernet?\n')
    draft += 'No, not for now.'
    draft = addQuote(draft, 'Shall I send the request to the coordinator?')!
    draft += 'Yes.'
    expect(draft).toBe('> Can you plug the box in over Ethernet?\nNo, not for now.\n> Shall I send the request to the coordinator?\nYes.')
    expect(quotesIn(draft).map(q => q.text)).toEqual(['Can you plug the box in over Ethernet?', 'Shall I send the request to the coordinator?'])
  })
  it('never quotes the same question twice', () => {
    const draft = addQuote('Hi\n', 'Shall I push?')!
    expect(isQuoted(draft, 'Shall I push?')).toBe(true)
    expect(isQuoted(draft, '  shall i   push? ')).toBe(true)
    expect(isQuoted(draft, 'Shall I merge?')).toBe(false)
    expect(addQuote(draft, 'Shall I push?')).toBeNull()
  })
  it('keeps two unanswered quotes apart', () => {
    const draft = addQuote(addQuote('', 'First?')!, 'Second?')!
    expect(draft).toBe('> First?\n\n> Second?\n')
    expect(quotesIn(draft).map(q => q.text)).toEqual(['First?', 'Second?'])
  })
  it('quotes a multi-line passage line by line, a very long one by its start and end', () => {
    expect(quoteOf('First line\n\n  second line  \n')).toBe('> First line\n> second line')
    const long = `${'word '.repeat(150)}end.`
    const q = quoteOf(long)
    expect(q.startsWith('> word')).toBe(true)
    expect(q.endsWith('end.')).toBe(true)
    expect(q.length).toBeLessThanOrEqual(QUOTE_MAX + 2)
    expect(q).toContain('…')
  })
  it('removes one quote and keeps the answers', () => {
    const draft = '> First?\nYes.\n> Second?\nNo.'
    const [first, second] = quotesIn(draft)
    expect(removeQuote(draft, first!)).toBe('Yes.\n> Second?\nNo.')
    expect(removeQuote(draft, second!)).toBe('> First?\nYes.\nNo.')
    expect(removeQuote('> Only?\n', quotesIn('> Only?\n')[0]!)).toBe('')
  })
})

describe('quoteSegments', () => {
  it('splits a sent message into quotes and answers', () => {
    expect(quoteSegments('> First?\nYes.\n> Second?\n> still second\nNo.')).toEqual([
      { quote: true, text: 'First?' },
      { quote: false, text: 'Yes.' },
      { quote: true, text: 'Second?\nstill second' },
      { quote: false, text: 'No.' },
    ])
    expect(quoteSegments('Plain message')).toEqual([{ quote: false, text: 'Plain message' }])
  })
})
