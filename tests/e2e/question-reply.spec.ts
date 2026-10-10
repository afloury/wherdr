import { expect, test, type Page } from '@playwright/test'
import { COORDINATOR_PANE, OMP_QUESTIONS_PANE } from './scenario.mjs'

// Reply targets of an agent reply (utils/questionReply.ts): each question and
// each point can be quoted in the field, in the three styles of
// Settings › Conversation › Reply style.
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

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

async function open(page: Page, style?: string, theme?: string) {
  // No typewriter: the replies are read as they will stay.
  await page.addInitScript(([s, th]) => {
    localStorage.setItem('typewriterSpeed', 'off')
    if (s) localStorage.setItem('replyStyle', s)
    if (th) localStorage.setItem('theme', th)
  }, [style, theme])
  await page.goto(`/#/a/${OMP_QUESTIONS_PANE}`)
  const chat = page.locator('.chat')
  await expect(chat.getByText('All 48 tests pass.')).toBeVisible()
  return { chat, field: page.locator('.prompt textarea').first() }
}
// The message list never scrolls sideways, whatever a style adds to it.
const fits = (page: Page) => page.locator('.chat-list').evaluate(el => el.scrollWidth <= el.clientWidth)

test('icon style: a question in the middle of a paragraph gets its own Reply button', async ({ page }, testInfo) => {
  const { chat, field } = await open(page)

  // One button per question, in reading order; none for the title, the quoted
  // words, the URL or the code.
  const buttons = chat.locator('.q-reply')
  await expect(buttons).toHaveCount(6)
  expect(await buttons.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.q))).toEqual([STEP, TAG, REVIEW, ETAPE, NOTES, MERGE])

  // The button sits right after the words of its question, before the sentence that follows.
  const step = chat.locator(quoteBtn(STEP))
  expect(await step.evaluate(el => [el.parentElement!.firstChild!.textContent, el.previousSibling?.textContent, el.nextSibling?.textContent])).toEqual([
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
  await shot(page, 'questions', testInfo.project.name)

  // A tap quotes the question alone, then the next one below it.
  await step.click()
  await expect(field).toHaveValue(`> ${STEP}\n`)
  await expect(step).toHaveClass(/quoted/)
  await chat.locator(quoteBtn(REVIEW)).click()
  await expect(field).toHaveValue(`> ${STEP}\n\n> ${REVIEW}\n`)
  await chat.locator(quoteBtn(ETAPE)).click()
  await expect(field).toHaveValue(`> ${STEP}\n\n> ${REVIEW}\n\n> ${ETAPE}\n`)
  await expect(chat.locator('.q-reply.quoted')).toHaveCount(3)
  await shot(page, 'questions-quoted', testInfo.project.name)
})

test('icon style: a point that asks nothing can be quoted to discuss it', async ({ page }, testInfo) => {
  const { chat, field } = await open(page, 'icon')
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
  await expect(field).toHaveValue(`> ${EXPORT}\n`)
  await expect(btn).toHaveClass(/quoted/)
  expect(await fits(page)).toBe(true)

  // Keyboard: the buttons are focusable and Enter quotes.
  const limits = chat.locator(quoteBtn(LIMITS, 'q-point'))
  await limits.focus()
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue(`> ${EXPORT}\n\n> ${LIMITS}\n`)
  await chat.locator(quoteBtn(MERGE)).focus()
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue(`> ${EXPORT}\n\n> ${LIMITS}\n\n> ${MERGE}\n`)
})

test('text style: the words of a question are its button, a point is clicked', async ({ page }, testInfo) => {
  const { chat, field } = await open(page, 'text')
  // No button in the text: the question is underlined.
  const words = chat.locator('.q-text', { hasText: MERGE })
  await words.scrollIntoViewIfNeeded()
  expect(await words.evaluate(el => getComputedStyle(el).textDecorationLine)).toBe('underline')
  expect(await chat.locator(quoteBtn(MERGE)).evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
  await words.click()
  await expect(field).toHaveValue(`> ${MERGE}\n`)
  await expect(words).toHaveClass(/quoted/)

  const item = chat.locator('li', { hasText: EXPORT })
  if (phone(testInfo.project.name)) {
    // A first tap only arms the point: reading or scrolling never quotes.
    await item.tap()
    await expect(item).toHaveClass(/q-armed/)
    await expect(field).toHaveValue(`> ${MERGE}\n`)
    const discuss = chat.locator(quoteBtn(EXPORT, 'q-point'))
    await expect(discuss).toBeVisible()
    expect(await discuss.evaluate(el => getComputedStyle(el, '::before').content)).toContain('Discuss')
    await shot(page, 'text-armed', testInfo.project.name)
    await discuss.tap()
    await expect(item).not.toHaveClass(/q-armed/)
  } else {
    await item.hover()
    await shot(page, 'text-hover', testInfo.project.name)
    await item.click()
  }
  await expect(field).toHaveValue(`> ${MERGE}\n\n> ${EXPORT}\n`)
  expect(await fits(page)).toBe(true)

  // Keyboard: the hidden buttons take the focus, show, and Enter quotes.
  const step = chat.locator(quoteBtn(STEP))
  await step.focus()
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue(`> ${MERGE}\n\n> ${EXPORT}\n\n> ${STEP}\n`)
  await chat.locator(quoteBtn(LIMITS, 'q-point')).focus()
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue(`> ${MERGE}\n\n> ${EXPORT}\n\n> ${STEP}\n\n> ${LIMITS}\n`)
})

test('text style: selecting text in a point still offers to reply to the passage', async ({ page }, testInfo) => {
  test.skip(phone(testInfo.project.name), 'a mouse selection')
  const { chat, field } = await open(page, 'text')
  const item = chat.locator('li', { hasText: EXPORT })
  await item.scrollIntoViewIfNeeded()
  const box = (await item.boundingBox())!
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  const selected = await page.evaluate(() => String(getSelection()))
  expect(selected.length).toBeGreaterThan(3)
  // The click that ends the selection quotes nothing; the passage button does.
  const reply = page.locator('.sel-reply')
  await expect(reply).toBeVisible()
  await expect(field).toHaveValue('')
  await reply.click()
  await expect(field).toHaveValue(`> ${selected.trim()}\n`)
})

test('list style: the questions are listed under the message, a point is picked', async ({ page }, testInfo) => {
  const { chat, field } = await open(page, 'list')
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
  await shot(page, 'list', testInfo.project.name)

  const row = bar.locator('.q-row')
  await expect(row).toHaveAccessibleName(`Reply: ${MERGE}`)
  await row.click()
  await expect(field).toHaveValue(`> ${MERGE}\n`)
  await expect(row).toHaveClass(/quoted/)
  await expect(chat.locator(quoteBtn(MERGE))).toHaveClass(/quoted/)

  // A point is not a target until "+ Quote a point" is pressed.
  const item = chat.locator('li', { hasText: EXPORT })
  await item.click()
  await expect(field).toHaveValue(`> ${MERGE}\n`)
  const pick = bar.locator('.q-pick')
  await expect(pick).toHaveText('+ Quote a point')
  await pick.click()
  await expect(pick).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(1)
  await item.scrollIntoViewIfNeeded()
  await shot(page, 'list-picking', testInfo.project.name)
  await item.click()
  await expect(field).toHaveValue(`> ${MERGE}\n\n> ${EXPORT}\n`)
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(0)
  expect(await fits(page)).toBe(true)

  // Keyboard: Enter on the bar, then on the point's own button; Escape cancels.
  await pick.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(1)
  await chat.locator(quoteBtn(LIMITS, 'q-point')).focus()
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue(`> ${MERGE}\n\n> ${EXPORT}\n\n> ${LIMITS}\n`)
  await pick.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(1)
  await page.locator('.msg-ai.q-picking .q-point').first().focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.msg-ai.q-picking')).toHaveCount(0)
})

test('list style: a reply of plain prose has nothing under it', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('typewriterSpeed', 'off')
    localStorage.setItem('replyStyle', 'list')
  })
  await page.goto(`/#/a/${COORDINATOR_PANE}`)
  const chat = page.locator('.chat')
  await expect(chat.getByText('Two threads are working.')).toBeVisible()
  await expect(page.locator('.chat-list.rs-list')).toBeVisible()
  // The sentence is still a point (the other styles quote it), but with
  // nothing to choose from there is no "+ Quote a point".
  await expect(chat.locator('.q-point')).toHaveCount(1)
  await expect(chat.locator('.q-bar')).toHaveCount(0)
  await expect(chat.locator('.q-pick')).toHaveCount(0)
  await shot(page, 'list-prose', testInfo.project.name)
})

test('the reply style is chosen in Settings and kept on the device', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('typewriterSpeed', 'off'))
  await page.goto('/#/settings?section=conversation')
  const group = page.locator('.reply-style-radio')
  await expect(group.getByRole('radio', { name: /^Icon/ })).toBeChecked()
  await group.getByText('Tap the text').click()
  await expect(group.getByRole('radio', { name: /^Tap the text/ })).toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('replyStyle'))).toBe('text')
  await page.goto(`/#/a/${OMP_QUESTIONS_PANE}`)
  await expect(page.locator('.chat-list.rs-text')).toBeVisible()
  await page.goto('/#/settings?section=conversation')
  await group.getByText('List under the message').click()
  await page.goto(`/#/a/${OMP_QUESTIONS_PANE}`)
  await expect(page.locator('.chat-list.rs-list .q-bar').first()).toBeVisible()
})

// Reference screenshots of each style, dark and light (SHOTS=<folder> only).
for (const style of ['icon', 'text', 'list']) {
  for (const theme of ['wherdr-titanium', 'catppuccin-latte']) {
    test(`screenshot: ${style} style, ${theme}`, async ({ page }, testInfo) => {
      test.skip(!process.env.SHOTS, 'screenshots on demand')
      if (!phone(testInfo.project.name)) await page.setViewportSize({ width: 1280, height: 800 })
      const { chat } = await open(page, style, theme)
      const item = chat.locator('li', { hasText: EXPORT })
      await chat.getByText('All 48 tests pass.').scrollIntoViewIfNeeded()
      if (phone(testInfo.project.name)) { if (style === 'text') await item.tap() } else if (style !== 'list') await item.hover()
      if (style === 'list') await chat.locator('.q-bar').nth(2).locator('.q-pick').click()
      await shot(page, `${style}-${theme === 'wherdr-titanium' ? 'dark' : 'light'}`, testInfo.project.name)
    })
  }
}
