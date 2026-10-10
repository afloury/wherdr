import { expect, test, type Page } from '@playwright/test'
import { OMP_DECISIONS_PANE } from './scenario.mjs'

// The panel under a decision table (utils/questionReply.ts, decisionRows):
// "OK to all", and Yes / No / Reply per numbered row. Everything is composed
// in the field; the user sends.
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

const ROWS = [
  ['1', 'Tag the release today?'],
  ['2', 'Keep the old export format for one more version?'],
  ['3', 'Publish the release notes on the site?'],
  ['4', 'Which name for the new theme?'],
]

async function open(page: Page, style?: string, language?: string) {
  await page.addInitScript(([s, l]) => {
    localStorage.setItem('typewriterSpeed', 'off')
    if (s) localStorage.setItem('replyStyle', s)
    if (l) localStorage.setItem('herdrLanguage', l)
  }, [style, language])
  await page.goto(`/#/a/${OMP_DECISIONS_PANE}`)
  const chat = page.locator('.chat')
  await expect(chat.locator('table')).toHaveCount(3)
  const field = page.locator('.prompt textarea').first()
  await field.fill('')
  return { chat, field, panel: chat.locator('.q-table') }
}
const fits = (page: Page) => page.locator('.chat-list').evaluate(el => el.scrollWidth <= el.clientWidth)
const sentCount = (page: Page) => page.locator('.msg-user-wrap').count()

test('a decision table is answered row by row under it; other tables get nothing', async ({ page }, testInfo) => {
  const { chat, field, panel } = await open(page)
  const before = await sentCount(page)
  // One panel, right under the table of decisions: not under the two others.
  await expect(panel).toHaveCount(1)
  expect(await panel.evaluate(el => [el.previousElementSibling!.tagName, el.previousElementSibling!.querySelector('th')!.textContent, el.getAttribute('aria-label')])).toEqual(['TABLE', '#', 'Decisions'])
  const rows = panel.locator('.q-trow')
  expect(await rows.evaluateAll(els => els.map(el => [(el as HTMLElement).dataset.n, (el as HTMLElement).dataset.q]))).toEqual(ROWS)
  // The words shown come from the row; the panel holds no text of its own.
  expect(await rows.nth(1).locator('.q-tl').evaluate(el => [getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content])).toEqual(['"2"', `"${ROWS[1]![1]}"`])
  expect(await panel.evaluate(el => el.textContent)).toBe('')
  await panel.scrollIntoViewIfNeeded()
  // Finger-sized buttons on a phone, on one line that never widens the page.
  const sizes = await rows.nth(1).locator('button').evaluateAll(els => els.map(el => el.getBoundingClientRect()).map(r => [Math.round(r.width), Math.round(r.height)]))
  const min = testInfo.project.name.includes('phone') ? 40 : 34
  for (const [w, h] of sizes) { expect(w).toBeGreaterThanOrEqual(36); expect(h).toBeGreaterThanOrEqual(min) }
  expect(await fits(page)).toBe(true)
  await shot(page, 'decisions', testInfo.project.name)

  // A row answered by its number; the other answer replaces it in place.
  await panel.getByRole('button', { name: '1 · Yes: Tag the release today?' }).click()
  await expect(field).toHaveValue('1: yes\n')
  await panel.getByRole('button', { name: `2 · No: ${ROWS[1]![1]}` }).click()
  await expect(field).toHaveValue('1: yes\n2: no\n')
  await expect(panel.getByRole('button', { name: `2 · No: ${ROWS[1]![1]}` })).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('button', { name: '1 · No: Tag the release today?' }).click()
  await expect(field).toHaveValue('1: no\n2: no\n')
  await expect(panel.getByRole('button', { name: '1 · Yes: Tag the release today?' })).toHaveAttribute('aria-pressed', 'false')
  // Reply quotes the row, with its number, for an answer in words.
  const reply = panel.getByRole('button', { name: `Reply: 4. ${ROWS[3]![1]}` })
  await reply.click()
  await expect(field).toHaveValue(`1: no\n2: no\n> 4. ${ROWS[3]![1]}\n`)
  await expect(reply).toHaveClass(/quoted/)
  await shot(page, 'decisions-answered', testInfo.project.name)
  // The field keeps the keyboard down for the taps, and nothing was sent.
  expect(await sentCount(page)).toBe(before)

  // "Which name…?" is an open question: Reply alone on its row.
  await expect(rows.nth(3).locator('.q-tans')).toHaveCount(0)
  await expect(rows.nth(2).locator('.q-tans')).toHaveCount(2)
  // The closing question of the message keeps its own Yes / No.
  await expect(chat.locator('.q-reply')).toHaveCount(1)
  await expect(chat.locator('.md-body .q-ans')).toHaveCount(2)
})

test('"OK to all" accepts the table in one line, a second tap takes it back', async ({ page }, testInfo) => {
  const { field, panel } = await open(page)
  const all = panel.locator('.q-all')
  await all.scrollIntoViewIfNeeded()
  expect(await all.evaluate(el => getComputedStyle(el, '::before').content)).toBe('"OK to all"')
  await all.click()
  await expect(field).toHaveValue('ok to all\n')
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  // An exception still goes below it.
  await panel.getByRole('button', { name: `3 · No: ${ROWS[2]![1]}` }).click()
  await expect(field).toHaveValue('ok to all\n3: no\n')
  await shot(page, 'decisions-ok-all', testInfo.project.name)
  await all.click()
  await expect(field).toHaveValue('3: no\n')
  await expect(all).toHaveAttribute('aria-pressed', 'false')
  // Keyboard: the buttons are focusable and Enter answers.
  await all.focus()
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('3: no\nok to all\n')
})

test('the panel speaks French and writes French answers', async ({ page }, testInfo) => {
  const { field, panel } = await open(page, undefined, 'fr')
  const all = panel.locator('.q-all')
  await all.scrollIntoViewIfNeeded()
  expect(await all.evaluate(el => getComputedStyle(el, '::before').content)).toBe('"Ok tout"')
  await panel.getByRole('button', { name: '1 · Oui: Tag the release today?' }).click()
  await panel.getByRole('button', { name: `2 · Non: ${ROWS[1]![1]}` }).click()
  await all.click()
  await expect(field).toHaveValue('1 : oui\n2 : non\nok tout\n')
  await shot(page, 'decisions-fr', testInfo.project.name)
})

for (const style of ['text', 'list']) {
  test(`the panel is the same in the ${style} reply style`, async ({ page }, testInfo) => {
    const { field, panel } = await open(page, style)
    await expect(panel.locator('.q-trow')).toHaveCount(4)
    await panel.scrollIntoViewIfNeeded()
    await panel.getByRole('button', { name: '1 · Yes: Tag the release today?' }).click()
    await panel.getByRole('button', { name: `Reply: 4. ${ROWS[3]![1]}` }).click()
    await expect(field).toHaveValue(`1: yes\n> 4. ${ROWS[3]![1]}\n`)
    expect(await fits(page)).toBe(true)
    await shot(page, `decisions-${style}`, testInfo.project.name)
  })
}
