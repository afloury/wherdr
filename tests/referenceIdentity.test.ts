// What keeps two references apart whatever their excerpts show: the code of
// the message, and of its decision table (shared/reference.ts messageId).
import { describe, expect, it } from 'vitest'
import { decisionRef, messageId, messageOf, messageRef, parseRef, pointRef, refLine, refsIn, sameRef, tableId } from '../shared/reference'
import { addAnswer, answerOf, rowRef, rowSettled, tableOf, tableRef, toggleOkAll, unansweredCount } from '../app/utils/questionReply'
import { findReplyOrigin } from '../shared/replyQuote'

describe('code of a message', () => {
  const first = { ts: '2026-01-01T11:37:02.120Z', text: 'Plan A. Shall I publish?' }
  const second = { ts: '2026-01-01T11:37:40.500Z', text: 'Plan B. Shall I publish?' }
  it('is three characters, the same for the same message whatever follows its first words', () => {
    expect(messageId(first)).toMatch(/^[0-9a-z]{3}$/)
    expect(messageId({ ...first })).toBe(messageId(first))
    const long = { ts: first.ts, text: `${'The first words of a long reply. '.repeat(3)}` }
    expect(messageId({ ts: long.ts, text: `${long.text}And a table added while it is written.` })).toBe(messageId(long))
  })
  it('differs for two messages of the same minute, and for a message without a time', () => {
    expect(messageId(second)).not.toBe(messageId(first))
    expect(messageId({ ts: null, text: first.text })).not.toBe(messageId({ ts: null, text: second.text }))
  })
  it('names the tables of a message after the first by their rank', () => {
    expect(tableId('k3f')).toBe('k3f')
    expect(tableId('k3f', 1)).toBe('k3f')
    expect(tableId('k3f', 2)).toBe('k3f2')
    expect(tableId(null, 2)).toBeNull()
    expect(messageOf('k3f2')).toBe('k3f')
    expect(messageOf('k3f')).toBe('k3f')
  })
  it('is written after the time and the row, and read back', () => {
    expect(refLine(pointRef('Shall I publish?', '11:37', 'k3f'))).toBe('↳ Quote point 11:37 ~k3f : Shall I publish? —')
    expect(refLine(messageRef('I can merge the PR', null, 'k3f'))).toBe('↳ Quote message ~k3f : I can merge the PR —')
    const row = decisionRef('3', 'Publish the notes?', '11:37', false, 'k3f2')
    expect(refLine(row)).toBe('↳ Quote decision 11:37 #3 ~k3f2 : Publish the notes? —')
    expect(parseRef(refLine(row))).toEqual(row)
    // An excerpt may hold what looks like a code.
    expect(parseRef('↳ Quote point 11:37 : about ~abc : fine? —')).toMatchObject({ id: null, excerpt: 'about ~abc : fine?' })
  })
  it('tells two references apart, the time when one of them has no code', () => {
    const ref = pointRef('Shall I publish?', '11:37', 'k3f')
    expect(sameRef(ref, pointRef('Shall I publish?', '11:37', 'k3f'))).toBe(true)
    expect(sameRef(ref, pointRef('Shall I publish?', '11:37', 'z9q'))).toBe(false)
    // The same message read on a device that shows another time zone.
    expect(sameRef(ref, pointRef('Shall I publish?', '13:37', 'k3f'))).toBe(true)
    // A reference of an earlier draft, written without a code.
    expect(sameRef(ref, pointRef('Shall I publish?', '11:37'))).toBe(true)
    expect(sameRef(ref, pointRef('Shall I publish?', '10:02'))).toBe(false)
  })
})

describe('two tables, two messages', () => {
  it('keeps two tables distinct when their first questions exceed the excerpt limit', () => {
    const common = 'Shall I keep the current configuration until the migration and all its validation checks finish?'
    const first = tableRef(tableOf([{ n: '1', text: common }, { n: '2', text: 'Keep staging?' }]), '11:37', 'k3f', 1)
    const second = tableRef(tableOf([{ n: '1', text: common }, { n: '2', text: 'Delete production?' }]), '11:37', 'k3f', 2)
    expect(first.excerpt).toBe(second.excerpt)
    expect(sameRef(first, second)).toBe(false)
    const draft = toggleOkAll('', first, 'OK to all')
    // "OK to all" on the second table adds its own reference: the first stays accepted.
    expect(toggleOkAll(draft, second, 'OK to all')).toBe(`${draft}${refLine(second)}\nOK to all\n`)
    // And a second tap on the first takes back that one only.
    expect(toggleOkAll(toggleOkAll(draft, second, 'OK to all'), first, 'OK to all')).toBe(`${refLine(second)}\nOK to all\n`)
  })
  it('does not replace an answer in another table with the same row text', () => {
    const one = { n: '1', text: 'Continue?', all: { n: '1-2', text: 'Continue? · Keep staging?' }, table: 1 }
    const two = { n: '1', text: 'Continue?', all: { n: '1-2', text: 'Continue? · Delete production?' }, table: 2 }
    const first = rowRef(one, '11:37', 'k3f')
    const second = rowRef(two, '11:37', 'k3f')
    const draft = addAnswer(addAnswer('', first, 'Yes')!, second, 'No')!
    expect(draft).toBe('↳ Quote decision 11:37 #1 ~k3f : Continue? —\nYes\n↳ Quote decision 11:37 #1 ~k3f2 : Continue? —\nNo\n')
    expect(refsIn(draft)).toHaveLength(2)
    expect(answerOf(draft, first)).toBe('Yes')
    expect(answerOf(draft, second)).toBe('No')
    // Each table knows its own rows as settled.
    const only = addAnswer('', first, 'Yes')!
    expect(rowSettled(only, one, '11:37', 'k3f')).toBe(true)
    expect(rowSettled(only, two, '11:37', 'k3f')).toBe(false)
    expect(unansweredCount({ questions: [], rows: [one, two] }, only, '11:37', 'k3f')).toBe(1)
  })
  it('does not take the same question of another message of the same minute for answered', () => {
    const draft = addAnswer('', pointRef('Shall I publish?', '11:37', 'k3f'), 'Yes')!
    expect(answerOf(draft, pointRef('Shall I publish?', '11:37', 'z9q'))).toBeNull()
    expect(unansweredCount({ questions: [{ n: '1', text: 'Shall I publish?', closed: true }, { n: '2', text: 'And tag it?', closed: true }], rows: [] }, draft, '11:37', 'z9q')).toBe(2)
  })
  it('shows the cited message rather than a later message containing the same point', () => {
    const cited = { time: '11:37', text: 'Plan A. Shall I publish?', key: 'original', rid: 'k3f' }
    const other = { time: '11:37', text: 'Plan B. Shall I publish?', key: 'later', rid: 'z9q' }
    const ref = pointRef('Shall I publish?', '11:37', 'k3f')
    expect(findReplyOrigin([cited, other], { time: ref.time!, excerpt: ref.excerpt, id: messageOf(ref.id!) })?.key).toBe('original')
    // A row of its second table leads to the same message.
    expect(findReplyOrigin([cited, other], { time: '11:37', excerpt: 'Continue?', id: messageOf('k3f2') })?.key).toBe('original')
    // Without a code, or with one no message shown has: the time and the excerpt, as before.
    expect(findReplyOrigin([cited, other], { time: '11:37', excerpt: ref.excerpt })?.key).toBe('later')
    expect(findReplyOrigin([cited, other], { time: '11:37', excerpt: 'Plan A', id: 'aaa' })?.key).toBe('original')
  })
})
