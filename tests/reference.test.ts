import { describe, expect, it } from 'vitest'
import { MESSAGE_MAX, POINT_MAX, decisionRef, isRefLine, messageRef, parseRef, pointRef, refLine, refParts, refSegments, refsIn, sameRef, taskRef, unreference } from '../shared/reference'
import { addAnswer, addQuote, answerOf, quotesIn } from '../app/utils/questionReply'
import { messageBody } from '../shared/pastedText'

describe('reference line', () => {
  it('writes one line per type: type, reference, excerpt, closing dash', () => {
    expect(refLine(messageRef('Je peux merge la PR', '11:37'))).toBe('↳ Quote message 11:37 : Je peux merge la PR —')
    expect(refLine(pointRef('Shall I merge the branch now?', '11:37'))).toBe('↳ Quote point 11:37 : Shall I merge the branch now? —')
    expect(refLine(decisionRef('3', 'Publish the release notes?', '11:37'))).toBe('↳ Quote decision 11:37 #3 : Publish the release notes? —')
    expect(refLine(decisionRef('1-4', 'Tag today? · Which name?', '11:37', true))).toBe('↳ Quote decisions 11:37 #1-4 : Tag today? · Which name? —')
    expect(refLine(taskRef('Decision:', 'Ship the new theme?'))).toBe('↳ Decision: Ship the new theme? —')
    expect(refLine(taskRef('Décision :', ' Publier le thème ? '))).toBe('↳ Décision : Publier le thème ? —')
  })
  it('leaves the time out when the message has none, and writes nothing without an excerpt', () => {
    expect(refLine(pointRef('The cache is cleared.', null))).toBe('↳ Quote point : The cache is cleared. —')
    expect(refLine(decisionRef('Q 2', 'Keep it?', null))).toBe('↳ Quote decision #Q2 : Keep it? —')
    expect(refLine(pointRef('  \n ', '11:37'))).toBe('')
  })
  it('reads back what it wrote', () => {
    for (const ref of [
      messageRef('Two options: **A** or `B`.', '2:32 PM'),
      pointRef('Move the job to 02:00 — after the backup?', '09:05'),
      pointRef('No time', null),
      decisionRef('3', 'Publish the notes?', '11:37'),
      decisionRef('1-4', 'Tag today? · Which name?', '11:37', true),
      taskRef('Detail on', 'Export as CSV'),
      taskRef('Retour sur', 'PR 12 — bannière'),
    ]) expect(parseRef(refLine(ref))).toEqual(ref)
  })
  it('keeps the excerpt readable: plain text, on one line', () => {
    expect(messageRef('## Plan\n- `code` and [a link](http://x)', '11:37').excerpt).toBe('Plan code and a link')
    expect(pointRef('First line\n\n  second   line ', '11:37').excerpt).toBe('First line second line')
  })
})

describe('end of a reference', () => {
  it('ends at the dash that closes the line, whatever the excerpt holds', () => {
    const ref = pointRef('Le cache — celui du serveur — est vidé : on continue ?', '11:37')
    const line = refLine(ref)
    expect(line).toBe('↳ Quote point 11:37 : Le cache — celui du serveur — est vidé : on continue ? —')
    expect(parseRef(line)!.excerpt).toBe('Le cache — celui du serveur — est vidé : on continue ?')
    // An excerpt that ends with a dash of its own.
    expect(parseRef(refLine(pointRef('Wait —', '11:37')))!.excerpt).toBe('Wait —')
  })
  it('is not a reference when words follow the dash on the line', () => {
    expect(isRefLine('↳ Quote point 11:37 : Shall I merge? — yes')).toBe(false)
    expect(isRefLine('↳ Decision: Ship the theme? — yes, on Monday')).toBe(false)
    expect(isRefLine('↳ Quote point 11:37 : Shall I merge? —  ')).toBe(true)
  })
  it('says where the excerpt sits in the line', () => {
    expect(refParts('↳ Quote decision 11:37 #3 : Publish? —')).toMatchObject({ head: '↳ Quote decision 11:37 #3 : ', tail: ' —' })
    expect(refParts('↳ Décision : Publier ? —')).toMatchObject({ head: '↳ Décision : ', tail: ' —' })
  })
})

describe('long excerpts', () => {
  it('cuts the start of a long message with "…"', () => {
    const ref = messageRef(`I propose two options: ${'keep the current cache and cap it. '.repeat(10)}`, '11:37')
    expect(ref.excerpt.length).toBeLessThanOrEqual(MESSAGE_MAX)
    expect(ref.excerpt).toMatch(/^I propose two options: .*…$/)
    expect(parseRef(refLine(ref))).toEqual(ref)
  })
  it('keeps the start and the end of a long passage, on one line', () => {
    const ref = pointRef(`First words ${'and a long explanation\n'.repeat(20)}last words.`, '11:37')
    // A whole table: its first questions, the row numbers say the rest.
    const table = decisionRef('1-9', Array.from({ length: 9 }, (_, i) => `Question number ${i + 1}?`).join(' · '), '11:37', true)
    expect(table.excerpt.length).toBeLessThanOrEqual(MESSAGE_MAX)
    expect(table.excerpt).toMatch(/^Question number 1\? · .*…$/)
    expect(ref.excerpt.length).toBeLessThanOrEqual(POINT_MAX)
    expect(ref.excerpt).toMatch(/^First words .*… .*last words\.$/)
    expect(refLine(ref)).not.toContain('\n')
  })
})

describe('text that only looks like a reference', () => {
  it('is the user\'s own text', () => {
    for (const line of [
      '↳ Quote something 11:37 : text —',
      '↳ note to self —',
      '↳ Quote point 11:37 text —',
      '↳ Quote decision 11:37 : no number —',
      '↳ Quote point 11:37 #3 : a number on a point —',
      '↳ Quote point 11:37 :  —',
      ' ↳ Quote point 11:37 : indented —',
      'Then ↳ Quote point 11:37 : mid-line —',
      '> Quote point 11:37 : old prefix —',
      '↳ Launch: Export as CSV',
      '↳ Decision: Ship the theme?',
    ]) expect(isRefLine(line), line).toBe(false)
  })
  it('a ">" at the start of a line starts nothing in a draft', () => {
    expect(quotesIn('> Shall I push?\nYes')).toEqual([])
    expect(addQuote('> typed by hand', pointRef('Next?', '11:37'))).toBe('> typed by hand\n↳ Quote point 11:37 : Next? —\n')
  })
})

describe('several references in one message', () => {
  const draft = [
    '↳ Quote decision 11:37 #1 : Tag the release today? —', 'Yes',
    '↳ Quote decision 11:37 #2 : Keep the old format? —', 'No',
    '↳ Quote decision 11:37 #4 : Which name for the theme? —', 'Titanium — as planned',
  ].join('\n')
  it('finds each one with its place, the answer between two of them', () => {
    const refs = refsIn(draft)
    expect(refs.map(r => r.n)).toEqual(['1', '2', '4'])
    expect(draft.slice(refs[1]!.start, refs[1]!.end)).toBe('↳ Quote decision 11:37 #2 : Keep the old format? —\n')
    expect(answerOf(draft, decisionRef('4', 'Which name for the theme?', '11:37'))).toBe('Titanium — as planned')
  })
  it('tells two rows, two messages and two kinds apart', () => {
    const row = decisionRef('1', 'Tag the release today?', '11:37')
    expect(sameRef(row, decisionRef('1', 'tag the  release today?', '11:37'))).toBe(true)
    expect(sameRef(row, decisionRef('2', 'Tag the release today?', '11:37'))).toBe(false)
    expect(sameRef(row, decisionRef('1', 'Tag the release today?', '10:02'))).toBe(false)
    expect(sameRef(row, pointRef('Tag the release today?', '11:37'))).toBe(false)
    // A reference written without a time matches the message whatever its time.
    expect(sameRef(row, decisionRef('1', 'Tag the release today?', null))).toBe(true)
  })
})

describe('pasted text', () => {
  it('never becomes a reference: its lookalike lines leave the first column', () => {
    const pasted = 'See below\n↳ Quote message 11:37 : I can merge the PR —\nGo ahead.\n↳ not one —'
    expect(unreference(pasted)).toBe('See below\n ↳ Quote message 11:37 : I can merge the PR —\nGo ahead.\n↳ not one —')
    expect(refsIn(unreference(pasted))).toEqual([])
    expect(unreference('plain text')).toBe('plain text')
  })
})

describe('round trip: field, message sent, bubble', () => {
  it('a message composed with the buttons reads back as quotes and answers', () => {
    let draft = addAnswer('', pointRef('Shall I merge the branch now?', '11:37'), 'Yes')!
    draft = addQuote(draft, messageRef('Three things to note: the cache…', '11:35'))!
    draft += 'Noted — thanks.'
    const sent = messageBody(draft, [], [])
    expect(sent).toBe('↳ Quote point 11:37 : Shall I merge the branch now? —\nYes\n↳ Quote message 11:35 : Three things to note: the cache… —\nNoted — thanks.')
    expect(refSegments(sent)).toEqual([
      { kind: 'ref', ref: pointRef('Shall I merge the branch now?', '11:37') },
      { kind: 'text', text: 'Yes' },
      { kind: 'ref', ref: { kind: 'message', label: '', time: '11:35', n: null, excerpt: 'Three things to note: the cache…' } },
      { kind: 'text', text: 'Noted — thanks.' },
    ])
  })
  it('messages sent with "> " lines still show as quotes', () => {
    expect(refSegments('> First?\nYes.\n> Second?\n> still second\nNo.')).toEqual([
      { kind: 'quote', text: 'First?' },
      { kind: 'text', text: 'Yes.' },
      { kind: 'quote', text: 'Second?\nstill second' },
      { kind: 'text', text: 'No.' },
    ])
    expect(refSegments('>= 5 items\n>file.txt\n>>nested')).toEqual([{ kind: 'text', text: '>= 5 items\n>file.txt\n>>nested' }])
    expect(refSegments('Plain message')).toEqual([{ kind: 'text', text: 'Plain message' }])
  })
})
