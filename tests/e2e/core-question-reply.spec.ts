import { expect, test, type FakeCore, type Locator, type Page } from './fake-core'
import { PROSE, QUESTIONS } from './fake-core-chats'
import { expectDraft, point } from './refs'

// Port of question-reply.spec.ts to herdr-core (Claude Code conversations, chromium-phone).
// Reply targets of an agent reply (utils/questionReply.ts): each question and each point
// can be quoted in the field, in the three styles of Settings › Conversation › Reply style.
// Dropped: the computer-only tests (Enter sends a Yes answer, mouse selection of a passage)
// and the SHOTS screenshot loop; the phone branch of each remaining test is kept.

const STEP = 'Shall I start step 1 now?'
const TAG = 'Shall I tag the release today?'
const REVIEW = 'Or do you want a review first?'
const ETAPE = 'Je lance l’étape 1 maintenant ?'
const NOTES = 'Dernier point : je publie les notes de version ?'
const MERGE = 'Shall I merge the branch now?'
const EXPORT = 'The export keeps its old column order.'
const LIMITS = 'The limits come from req.plan.limits.'
const POINTS = [
  'You asked "can it be faster?" earlier. The page is at https://example.com/search?x=1 and ready ? 1 : 0 stays as it is.',
  'Tu as demandé « on peut aller plus vite ? » hier. C’est fait.',
  'The cache is cleared on every deploy.',
  EXPORT,
  LIMITS,
]

const phone = (project: string) => project.includes('phone')
const quoteBtn = (text: string, kind = 'q-reply') => `.${kind}[data-q="${text.replace(/"/g, '\\"')}"]`

async function open(page: Page, core: FakeCore, style?: string) {
  // No typewriter: the replies are read as they will stay.
  await page.addInitScript((s) => {
    localStorage.setItem('typewriterSpeed', 'off')
    if (s) localStorage.setItem('replyStyle', s)
  }, style)
  await page.goto(core.claude('questions', QUESTIONS).url)
  const chat = page.locator('.chat')
  await expect(chat.getByText('All 48 tests pass.')).toBeVisible()
  return { chat, field: page.locator('.prompt textarea').first() }
}
// The message list never scrolls sideways, whatever a style adds to it.
const fits = (page: Page) => page.locator('.chat-list').evaluate(el => el.scrollWidth <= el.clientWidth)

test('icon style: a question in the middle of a paragraph gets its own Reply button', async ({ page, core }) => {
  const { chat, field } = await open(page, core)

  // One button per question, in reading order; none for the title, the quoted
  // words, the URL or the code.
  const buttons = chat.locator('.q-reply')
  await expect(buttons).toHaveCount(6)
  expect(await buttons.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.q))).toEqual([STEP, TAG, REVIEW, ETAPE, NOTES, MERGE])

  // The button sits right after the words of its question, before the sentence that follows.
  const step = chat.locator(quoteBtn(STEP))
  // (Its one-tap answers come in between: see the "Yes / No" test.)
  expect(await step.evaluate(el => [el.parentElement!.firstChild!.textContent, el.previousSibling?.textContent, el.parentElement!.lastChild!.textContent])).toEqual([
    'I added the task to the queue, to be confirmed. ',
    STEP,
    ' A slot is free on the server.',
  ])
  // In the middle or at the end of its message, a question shows the same icon.
  for (const q of [STEP, NOTES, MERGE]) {
    const btn = chat.locator(quoteBtn(q))
    await expect(btn).toBeVisible()
    expect(await btn.evaluate(el => [getComputedStyle(el, '::before').content, Number(getComputedStyle(el).opacity) > 0.8])).toEqual(['"↳"', true])
  }
  await step.scrollIntoViewIfNeeded()

  // A tap quotes the question alone, then the next one below it.
  await step.click()
  await expectDraft(field, `${point(STEP)}\n`)
  await expect(step).toHaveClass(/quoted/)
  await chat.locator(quoteBtn(REVIEW)).click()
  await expectDraft(field, `${point(STEP)}\n\n${point(REVIEW)}\n`)
  await chat.locator(quoteBtn(ETAPE)).click()
  await expectDraft(field, `${point(STEP)}\n\n${point(REVIEW)}\n\n${point(ETAPE)}\n`)
  await expect(chat.locator('.q-reply.quoted')).toHaveCount(3)
})

// One-tap answers: "Yes" / "No" next to the Reply button of a closed question.
const ansBtn = (text: string, a: 'yes' | 'no') => quoteBtn(text, `q-${a}`)
const sentCount = (page: Page) => page.locator('.msg-user-wrap').count()
// Caret of the field when it has the focus, else null.
const focusedAt = (field: Locator) => field.evaluate((el: HTMLTextAreaElement) => document.activeElement === el ? el.selectionStart : null)

test('a closed question is answered in one tap, several in a row, nothing is sent', async ({ page, core }, testInfo) => {
  const { chat, field } = await open(page, core)
  const before = await sentCount(page)
  // Yes and No for the five closed questions; none for "Or do you want a review first?".
  expect(await chat.locator('.q-yes').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.q))).toEqual([STEP, TAG, ETAPE, NOTES, MERGE])
  await expect(chat.locator('.q-no')).toHaveCount(5)
  await expect(chat.locator(ansBtn(REVIEW, 'yes'))).toHaveCount(0)

  const yes = chat.locator(ansBtn(STEP, 'yes'))
  const no = chat.locator(ansBtn(STEP, 'no'))
  await yes.scrollIntoViewIfNeeded()
  await expect(yes).toBeVisible()
  expect(await yes.evaluate(el => getComputedStyle(el, '::before').content)).toBe('"Yes"')
  expect(await yes.getAttribute('aria-label')).toBe(`Yes: ${STEP}`)
  // Finger-sized targets that do not overlap, and a line as tall as its neighbours.
  const target = (el: Element) => {
    const r = el.getBoundingClientRect()
    const a = getComputedStyle(el, '::after')
    return { left: r.left + parseFloat(a.left), right: r.right - parseFloat(a.right), height: parseFloat(a.height) }
  }
  const [ty, tn] = [await yes.evaluate(target), await no.evaluate(target)]
  expect(ty.height).toBeGreaterThanOrEqual(32)
  expect(ty.right).toBeLessThanOrEqual(tn.left)
  expect(await yes.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(22)

  await yes.click()
  await expectDraft(field, `${point(STEP)}\nYes\n`)
  await expect(yes).toHaveAttribute('aria-pressed', 'true')
  await expect(chat.locator(quoteBtn(STEP))).toHaveClass(/quoted/)
  // On a computer the field takes the focus, the caret right after the answer,
  // so that Enter sends it. On a phone it does not: the keyboard stays down and
  // the next question stays in sight.
  if (phone(testInfo.project.name)) expect(await focusedAt(field)).toBeNull()
  else await expect.poll(() => focusedAt(field)).toBe((await field.inputValue()).length - 1)
  await chat.locator(ansBtn(TAG, 'no')).click()
  await expectDraft(field, `${point(STEP)}\nYes\n${point(TAG)}\nNo\n`)
  // A plain Reply joins them, and the other answer replaces the first.
  await chat.locator(quoteBtn(REVIEW)).click()
  await expectDraft(field, `${point(STEP)}\nYes\n${point(TAG)}\nNo\n${point(REVIEW)}\n`)
  await no.click()
  await expectDraft(field, `${point(STEP)}\nNo\n${point(TAG)}\nNo\n${point(REVIEW)}\n`)
  await expect(no).toHaveAttribute('aria-pressed', 'true')
  await expect(yes).toHaveAttribute('aria-pressed', 'false')
  // Typed words under a quote are the user's: a tap leaves them alone.
  await field.fill((await field.inputValue()).replace(/\n[\s\S]*$/, '\nNo, tomorrow.\n'))
  await yes.click()
  await expectDraft(field, `${point(STEP)}\nNo, tomorrow.\n`)
  expect(await sentCount(page)).toBe(before)
  expect(await fits(page)).toBe(true)
})

test('text style: Yes / No stay next to the underlined question', async ({ page, core }) => {
  const { chat, field } = await open(page, core, 'text')
  await field.fill('')
  const yes = chat.locator(ansBtn(MERGE, 'yes'))
  await yes.scrollIntoViewIfNeeded()
  await expect(yes).toBeVisible()
  await yes.click()
  await expectDraft(field, `${point(MERGE)}\nYes\n`)
  await expect(chat.locator('.q-text', { hasText: MERGE })).toHaveClass(/quoted/)
})

test('list style: Yes / No sit in the question row under the message, not in the text', async ({ page, core }) => {
  const { chat, field } = await open(page, core, 'list')
  await field.fill('')
  await expect(chat.locator('.md-body .q-ans').first()).toBeHidden()
  const bars = chat.locator('.q-bar')
  // The open question of the first message has a row without answers.
  await expect(bars.nth(0).locator('.q-line')).toHaveCount(3)
  await expect(bars.nth(0).locator('.q-row-ans')).toHaveCount(4)
  const line = bars.nth(2).locator('.q-line')
  await line.scrollIntoViewIfNeeded()
  await line.getByRole('button', { name: `No: ${MERGE}` }).click()
  await expectDraft(field, `${point(MERGE)}\nNo\n`)
  await expect(line.getByRole('button', { name: `No: ${MERGE}` })).toHaveAttribute('aria-pressed', 'true')
  await expect(line.locator('.q-row')).toHaveClass(/quoted/)
  expect(await fits(page)).toBe(true)
})

test('icon style: a point that asks nothing can be quoted to discuss it', async ({ page, core }, testInfo) => {
  const { chat, field } = await open(page, core, 'icon')
  // Paragraphs and list items without a question; not the introduction, the title or the code.
  const points = chat.locator('.q-point')
  expect(await points.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.q))).toEqual(POINTS)
  const item = chat.locator('li', { hasText: EXPORT })
  const btn = chat.locator(quoteBtn(EXPORT, 'q-point'))
  await item.scrollIntoViewIfNeeded()
  if (phone(testInfo.project.name)) {
    // No hover on a touch screen: always there, pale, with a finger-sized target.
    expect(await btn.evaluate(el => [Number(getComputedStyle(el).opacity), parseFloat(getComputedStyle(el, '::after').width), parseFloat(getComputedStyle(el, '::after').height)])).toEqual([0.5, 32, 32])
    await btn.tap()
  } else {
    // Hidden until its point is hovered, and it takes no room in the line.
    expect(await btn.evaluate(el => [getComputedStyle(el).opacity, el.getBoundingClientRect().width])).toEqual(['0', 0])
    await item.hover()
    await expect(btn).toHaveCSS('opacity', '1')
    // The glyph hangs from the anchor: click where it is drawn.
    const at = await btn.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left + 0.45 * parseFloat(getComputedStyle(el).fontSize) + 9, y: r.top + r.height * 0.62 }
    })
    await page.mouse.click(at.x, at.y)
  }
  await expectDraft(field, `${point(EXPORT)}\n`)
  await expect(btn).toHaveClass(/quoted/)
  expect(await fits(page)).toBe(true)

  // Keyboard: the buttons are focusable and Enter quotes.
  const limits = chat.locator(quoteBtn(LIMITS, 'q-point'))
  await limits.focus()
  await page.keyboard.press('Enter')
  await expectDraft(field, `${point(EXPORT)}\n\n${point(LIMITS)}\n`)
  await chat.locator(quoteBtn(MERGE)).focus()
  await page.keyboard.press('Enter')
  await expectDraft(field, `${point(EXPORT)}\n\n${point(LIMITS)}\n\n${point(MERGE)}\n`)
})

test('text style: the words of a question are its button, a point is clicked', async ({ page, core }, testInfo) => {
  const { chat, field } = await open(page, core, 'text')
  // No button in the text: the question is underlined.
  const words = chat.locator('.q-text', { hasText: MERGE })
  await words.scrollIntoViewIfNeeded()
  expect(await words.evaluate(el => getComputedStyle(el).textDecorationLine)).toBe('underline')
  expect(await chat.locator(quoteBtn(MERGE)).evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
  await words.click()
  await expectDraft(field, `${point(MERGE)}\n`)
  await expect(words).toHaveClass(/quoted/)

  const item = chat.locator('li', { hasText: EXPORT })
  if (phone(testInfo.project.name)) {
    // A first tap only arms the point: reading or scrolling never quotes.
    await item.tap()
    await expect(item).toHaveClass(/q-armed/)
    await expectDraft(field, `${point(MERGE)}\n`)
    const discuss = chat.locator(quoteBtn(EXPORT, 'q-point'))
    await expect(discuss).toBeVisible()
    expect(await discuss.evaluate(el => getComputedStyle(el, '::before').content)).toContain('Discuss')
    await discuss.tap()
    await expect(item).not.toHaveClass(/q-armed/)
  } else {
    await item.hover()
    await item.click()
  }
  await expectDraft(field, `${point(MERGE)}\n\n${point(EXPORT)}\n`)
  expect(await fits(page)).toBe(true)

  // Keyboard: the hidden buttons take the focus, show, and Enter quotes.
  const step = chat.locator(quoteBtn(STEP))
  await step.focus()
  await page.keyboard.press('Enter')
  await expectDraft(field, `${point(MERGE)}\n\n${point(EXPORT)}\n\n${point(STEP)}\n`)
  await chat.locator(quoteBtn(LIMITS, 'q-point')).focus()
  await page.keyboard.press('Enter')
  await expectDraft(field, `${point(MERGE)}\n\n${point(EXPORT)}\n\n${point(STEP)}\n\n${point(LIMITS)}\n`)
})

test('list style: the questions are listed under the message, a point is picked', async ({ page, core }) => {
  const { chat, field } = await open(page, core, 'list')
  // A number after each question, restarting in each message.
  expect(await chat.locator('.q-reply').evaluateAll(els => els.map(el => getComputedStyle(el, '::before').content))).toEqual(['"1"', '"2"', '"3"', '"1"', '"2"', '"1"'])
  const bars = chat.locator('.q-bar')
  await expect(bars).toHaveCount(3)
  expect(await bars.nth(0).locator('.q-row > span').allTextContents()).toEqual([STEP, TAG, REVIEW])
  // Only the reply with a list offers to pick a point: the single paragraph
  // without a question of the two others is not a choice.
  await expect(chat.locator('.q-pick')).toHaveCount(1)
  await expect(bars.nth(0).locator('.q-pick')).toHaveCount(0)
  const bar = bars.nth(2)
  await bar.scrollIntoViewIfNeeded()

  const row = bar.locator('.q-row')
  await expect(row).toHaveAccessibleName(`Reply: ${MERGE}`)
  await row.click()
  await expectDraft(field, `${point(MERGE)}\n`)
  await expect(row).toHaveClass(/quoted/)
  await expect(chat.locator(quoteBtn(MERGE))).toHaveClass(/quoted/)

  // A point is not a target until "+ Quote a point" is pressed.
  const item = chat.locator('li', { hasText: EXPORT })
  await item.click()
  await expectDraft(field, `${point(MERGE)}\n`)
  const pick = bar.locator('.q-pick')
  await expect(pick).toHaveText('+ Quote a point')
  await pick.click()
  await expect(pick).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(1)
  await item.scrollIntoViewIfNeeded()
  await item.click()
  await expectDraft(field, `${point(MERGE)}\n\n${point(EXPORT)}\n`)
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(0)
  expect(await fits(page)).toBe(true)

  // Keyboard: Enter on the bar, then on the point's own button; Escape cancels.
  await pick.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(1)
  await chat.locator(quoteBtn(LIMITS, 'q-point')).focus()
  await page.keyboard.press('Enter')
  await expectDraft(field, `${point(MERGE)}\n\n${point(EXPORT)}\n\n${point(LIMITS)}\n`)
  await pick.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(1)
  await page.locator('.msg-ai.q-picking .q-point').first().focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(0)
})

test('list style: a reply of plain prose has nothing under it', async ({ page, core }) => {
  await page.addInitScript(() => {
    localStorage.setItem('typewriterSpeed', 'off')
    localStorage.setItem('replyStyle', 'list')
  })
  await page.goto(core.claude('acme', PROSE).url)
  const chat = page.locator('.chat')
  await expect(chat.getByText('Two threads are working.')).toBeVisible()
  await expect(page.locator('.chat-list.rs-list')).toBeVisible()
  // The sentence is still a point (the other styles quote it), but with
  // nothing to choose from there is no "+ Quote a point".
  await expect(chat.locator('.q-point')).toHaveCount(1)
  await expect(chat.locator('.q-bar')).toHaveCount(0)
  await expect(chat.locator('.q-pick')).toHaveCount(0)
})

test('the reply style is chosen in Settings and kept on the device', async ({ page, core }) => {
  const questions = core.claude('questions', QUESTIONS)
  await page.addInitScript(() => localStorage.setItem('typewriterSpeed', 'off'))
  await page.goto('/#/settings?section=conversation')
  const group = page.locator('.reply-style-radio')
  await expect(group.getByRole('radio', { name: /^Icon/ })).toBeChecked()
  await group.getByText('Tap the text').click()
  await expect(group.getByRole('radio', { name: /^Tap the text/ })).toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('replyStyle'))).toBe('text')
  await page.goto(questions.url)
  await expect(page.locator('.chat-list.rs-text')).toBeVisible()
  await page.goto('/#/settings?section=conversation')
  await group.getByText('List under the message').click()
  await page.goto(questions.url)
  await expect(page.locator('.chat-list.rs-list .q-bar').first()).toBeVisible()
})

