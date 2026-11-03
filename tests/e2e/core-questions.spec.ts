import { expect, test, type FakeCore, type Locator, type Page } from './fake-core'
import { DECISIONS, FOLLOWUP, FOLLOWUP_REPLY, QUESTIONS } from './fake-core-chats'
import { decision, decisions, draftOf, expectDraft, point } from './refs'

// Answering an agent's questions on herdr-core, end to end in a real browser: reply buttons
// and Yes / No in a Claude Code conversation, the list style chosen in Settings, the decision
// table panel with its "N questions unanswered" reminder, and a sent answer clearing it.
// Merged from question-reply, unanswered-questions and decision-table.spec.ts. What a
// question is, how a tap writes the draft, which rows count, the French and per-style
// variants: tests/questionReply.test.ts and components/markQuestions, QuotedText,
// ComposerReferences.
const STEP = 'Shall I start step 1 now?'
const TAG = 'Shall I tag the release today?'
const REVIEW = 'Or do you want a review first?'
const ETAPE = 'Je lance l’étape 1 maintenant ?'
const NOTES = 'Dernier point : je publie les notes de version ?'
const MERGE = 'Shall I merge the branch now?'
const EXPORT = 'The export keeps its old column order.'
const ROWS = [
  ['1', 'Tag the release today?'],
  ['2', 'Keep the old export format for one more version?'],
  ['3', 'Publish the release notes on the site?'],
  ['4', 'Which name for the new theme?'],
]
const row = (n: number) => decision(ROWS[n - 1]![0]!, ROWS[n - 1]![1]!)
const ALL = decisions('1-4', ROWS.map(r => r[1]).join(' · '))
const quoteBtn = (text: string, kind = 'q-reply') => `.${kind}[data-q="${text.replace(/"/g, '\\"')}"]`
// The message list never scrolls sideways, whatever a style adds to it.
const fits = (page: Page) => page.locator('.chat-list').evaluate(el => el.scrollWidth <= el.clientWidth)
const top = (page: Page, sel: string) => page.locator(sel).first().evaluate(el => Math.round(el.getBoundingClientRect().top))
// The smooth scroll of the reminder is over: a tap during it lands elsewhere.
const scrolled = (chat: Locator) => chat.evaluate(el => new Promise<void>((done) => {
  let last = el.scrollTop
  let still = 0
  const frame = () => {
    still = el.scrollTop === last ? still + 1 : 0
    last = el.scrollTop
    if (still >= 10) done()
    else requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}))

async function open(page: Page, url: string, text: string) {
  // No typewriter: the replies are read as they will stay.
  await page.addInitScript(() => localStorage.setItem('typewriterSpeed', 'off'))
  await page.goto(url)
  const chat = page.locator('.chat')
  await expect(chat.getByText(text).last()).toBeVisible()
  return { chat, field: page.locator('.prompt textarea').first(), ask: page.locator('.composer-ask') }
}
const questions = (core: FakeCore) => core.claude('questions', QUESTIONS)

test('icon style: each question gets a Reply button and finger-sized Yes / No, and nothing is sent', async ({ page, core }) => {
  const { chat, field } = await open(page, questions(core).url, 'All 48 tests pass.')
  const buttons = chat.locator('.q-reply')
  await expect(buttons).toHaveCount(6)
  expect(await buttons.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.q))).toEqual([STEP, TAG, REVIEW, ETAPE, NOTES, MERGE])
  // A tap quotes the question alone, then the next one below it.
  const step = chat.locator(quoteBtn(STEP))
  await step.scrollIntoViewIfNeeded()
  await step.click()
  await expectDraft(field, `${point(STEP)}\n`)
  await expect(step).toHaveClass(/quoted/)
  await chat.locator(quoteBtn(REVIEW)).click()
  await expectDraft(field, `${point(STEP)}\n\n${point(REVIEW)}\n`)
  await field.fill('')

  // Yes / No: targets that do not overlap, on a line as tall as its neighbours.
  const yes = chat.locator(quoteBtn(STEP, 'q-yes'))
  const no = chat.locator(quoteBtn(STEP, 'q-no'))
  await expect(chat.locator(quoteBtn(REVIEW, 'q-yes'))).toHaveCount(0)
  const target = (el: Element) => {
    const r = el.getBoundingClientRect()
    const a = getComputedStyle(el, '::after')
    return { left: r.left + parseFloat(a.left), right: r.right - parseFloat(a.right), height: parseFloat(a.height) }
  }
  const [ty, tn] = [await yes.evaluate(target), await no.evaluate(target)]
  expect(ty.height).toBeGreaterThanOrEqual(32)
  expect(ty.right).toBeLessThanOrEqual(tn.left)
  expect(await yes.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(22)
  const sent = await page.locator('.msg-user-wrap').count()
  await yes.click()
  await expectDraft(field, `${point(STEP)}\nYes\n`)
  // On a phone the keyboard stays down: the field does not take the focus.
  await expect(field).not.toBeFocused()
  await no.click()
  await expectDraft(field, `${point(STEP)}\nNo\n`)
  await expect(no).toHaveAttribute('aria-pressed', 'true')
  await expect(yes).toHaveAttribute('aria-pressed', 'false')
  expect(await page.locator('.msg-user-wrap').count()).toBe(sent)
  expect(core.terminals[0]!.sends).toEqual([])
  expect(await fits(page)).toBe(true)
})

test('list style, chosen in Settings: questions listed under the message, a point picked', async ({ page, core }) => {
  const agent = questions(core)
  await page.addInitScript(() => localStorage.setItem('typewriterSpeed', 'off'))
  await page.goto('/#/settings?section=conversation')
  const group = page.locator('.reply-style-radio')
  await expect(group.getByRole('radio', { name: /^Icon/ })).toBeChecked()
  await group.getByText('List under the message').click()
  await expect(group.getByRole('radio', { name: /^List under the message/ })).toBeChecked()
  await page.goto(agent.url)
  const chat = page.locator('.chat')
  const field = page.locator('.prompt textarea').first()
  await expect(page.locator('.chat-list.rs-list')).toBeVisible()
  const bars = chat.locator('.q-bar')
  await expect(bars).toHaveCount(3)
  const bar = bars.nth(2)
  await bar.scrollIntoViewIfNeeded()
  const merge = bar.locator('.q-row')
  await expect(merge).toHaveAccessibleName(`Reply: ${MERGE}`)
  await merge.click()
  await expectDraft(field, `${point(MERGE)}\n`)
  // A point is not a target until "+ Quote a point" is pressed.
  const item = chat.locator('li', { hasText: EXPORT })
  await item.click()
  await expectDraft(field, `${point(MERGE)}\n`)
  await bar.locator('.q-pick').click()
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(1)
  await item.scrollIntoViewIfNeeded()
  await item.click()
  await expectDraft(field, `${point(MERGE)}\n\n${point(EXPORT)}\n`)
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(0)
  expect(await fits(page)).toBe(true)
  // Kept on the device.
  await page.reload()
  await expect(page.locator('.chat-list.rs-list .q-bar').first()).toBeVisible()
})

test('a decision table is answered under it, the reminder counts down, and nothing moves under the finger', async ({ page, core }) => {
  const { chat, field, ask } = await open(page, core.claude('decisions', DECISIONS).url, 'Four decisions are waiting for you:')
  await field.fill('')
  const prompt = page.locator('.prompt')
  // One panel, right under the table of decisions: not under the two other tables.
  const panel = chat.locator('.q-table')
  await expect(chat.locator('table')).toHaveCount(3)
  await expect(panel).toHaveCount(1)
  expect(await panel.evaluate(el => el.previousElementSibling!.querySelector('th')!.textContent)).toBe('#')
  // Four rows and the closing question.
  await expect(ask).toHaveText('5 questions unanswered')
  expect(await ask.evaluate(el => getComputedStyle(el).position)).toBe('absolute')

  // A finger held on an answer while the empty field loses the focus: the composer does
  // not collapse and move the button before release.
  const answer = panel.getByRole('button', { name: '1 · Yes: Tag the release today?', exact: true })
  await panel.scrollIntoViewIfNeeded()
  await expect(prompt).toHaveClass(/expanded/)
  const sizes = await panel.locator('.q-trow').nth(1).locator('button').evaluateAll(els => els.map(el => el.getBoundingClientRect()).map(r => [r.width, r.height]))
  for (const [w, h] of sizes) { expect(w).toBeGreaterThanOrEqual(36); expect(h).toBeGreaterThanOrEqual(40) }
  const rowTop = await top(page, '.q-trow')
  const box = (await answer.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  try {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(prompt).toHaveClass(/expanded/)
    expect((await answer.boundingBox())!.y).toBeCloseTo(box.y, 0)
  } finally { await page.mouse.up() }
  await expectDraft(field, `${row(1)}\nYes\n`)
  await expect(ask).toHaveText('4 questions unanswered')
  await expect(field).not.toBeFocused()
  expect(await top(page, '.q-trow')).toBe(rowTop)

  // "OK to all" settles the table; the field grows with its chips, the rows stay put.
  await panel.locator('.q-all').click()
  await expectDraft(field, `${row(1)}\nYes\n${ALL}\nOK to all\n`)
  await expect(page.locator('.composer-quote').first()).toBeVisible()
  await expect(ask).toHaveText('1 question unanswered')
  await scrolled(chat)
  expect(await top(page, '.q-trow')).toBe(rowTop)
  // The other answer replaces it in place; Reply refers to a row for an answer in words.
  await panel.getByRole('button', { name: '1 · No: Tag the release today?' }).click()
  await expectDraft(field, `${row(1)}\nNo\n${ALL}\nOK to all\n`)
  await panel.getByRole('button', { name: `Reply: 4. ${ROWS[3]![1]}` }).click()
  await expect.poll(() => draftOf(field)).toContain(row(4))
  // A tap on the reminder scrolls to the question left and flashes it.
  await chat.evaluate(el => el.scrollTo(0, 0))
  await ask.click()
  await expect(chat.locator('.q-text.q-flash')).toHaveText('Shall I start the next thread meanwhile?')
  await scrolled(chat)
  await chat.locator('.q-yes[data-q="Shall I start the next thread meanwhile?"]').click()
  await expect(ask).toHaveCount(0)
  expect(await fits(page)).toBe(true)
})

test('only the last agent message is counted, and a sent answer clears the reminder until the next reply', async ({ page, core }) => {
  const agent = core.claude('followup', FOLLOWUP, { reply: FOLLOWUP_REPLY })
  const { chat, field, ask } = await open(page, agent.url, 'Review the plan.')
  await field.fill('')
  // "Was the first draft fine?" belongs to an earlier message: never counted.
  await expect(ask).toHaveText('2 questions unanswered')
  await chat.locator('.q-yes[data-q="Shall I rename the module?"]').click()
  await expect(ask).toHaveText('1 question unanswered')
  await chat.locator('.q-reply[data-q="Which name do you prefer?"]').click()
  await expect(ask).toHaveCount(0)
  await page.keyboard.type('core')
  await page.locator('.prompt-send').click()
  // Sent: the draft is empty again, and no reminder while the message is on its way.
  await expect(page.locator('.msg-pending')).toBeVisible()
  await expect(field).toHaveValue('')
  await expect(ask).toHaveCount(0)
  await expect.poll(() => agent.sends.length).toBe(1)
  expect(agent.sends[0]).toContain('Shall I rename the module?')
  // The agent's new reply asks one thing: the reminder is about that one.
  await expect(chat.getByText(FOLLOWUP_REPLY)).toHaveCount(1)
  await expect(ask).toHaveText('1 question unanswered')
})
