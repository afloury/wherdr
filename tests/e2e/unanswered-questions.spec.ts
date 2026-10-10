import { expect, test, type Page } from '@playwright/test'
import { COORDINATOR_PANE, FOLLOWUP_REPLY, OMP_DECISIONS_PANE, OMP_FOLLOWUP_PANE } from './scenario.mjs'

// "N questions unanswered" above the field: the questions of the agent's last
// message that the draft does not answer yet (utils/questionReply.ts,
// unansweredCount). A tap scrolls to the first one.
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

async function open(page: Page, pane: string, text: string) {
  await page.addInitScript(() => localStorage.setItem('typewriterSpeed', 'off'))
  await page.goto(`/#/a/${pane}`)
  const chat = page.locator('.chat')
  await expect(chat.getByText(text).last()).toBeVisible()
  const field = page.locator('.prompt textarea').first()
  await field.fill('')
  return { chat, field, ask: page.locator('.composer-ask') }
}
const top = (page: Page, sel: string) => page.locator(sel).first().evaluate(el => Math.round(el.getBoundingClientRect().top))

test('the reminder counts the rows and questions left, and goes once all are answered', async ({ page }, testInfo) => {
  const { chat, field, ask } = await open(page, OMP_DECISIONS_PANE, 'Four decisions are waiting for you:')
  // Four rows and the closing question.
  await expect(ask).toHaveText('5 questions unanswered')
  // Out of the flow: it sits over the bottom of the conversation, the field does not move for it.
  expect(await ask.evaluate(el => getComputedStyle(el).position)).toBe('absolute')
  expect(await ask.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(24)
  await shot(page, 'unanswered', testInfo.project.name)

  // A tap scrolls to the first one: the first row of the table.
  await chat.evaluate(el => el.scrollTo(0, 0))
  await ask.click()
  const first = chat.locator('.q-trow').first()
  await expect(first).toBeInViewport()
  await expect(first).toHaveClass(/q-flash/)
  await shot(page, 'unanswered-goto', testInfo.project.name)

  const panel = chat.locator('.q-table')
  await panel.getByRole('button', { name: '1 · Yes: Tag the release today?' }).click()
  await expect(ask).toHaveText('4 questions unanswered')
  await panel.getByRole('button', { name: 'Reply: 4. Which name for the new theme?' }).click()
  await expect(ask).toHaveText('3 questions unanswered')
  await panel.locator('.q-all').click()
  // The table is settled; the question under it is not.
  await expect(ask).toHaveText('1 question unanswered')
  await ask.click()
  await expect(chat.locator('.q-text.q-flash')).toHaveText('Shall I start the next thread meanwhile?')
  await chat.locator('.q-yes[data-q="Shall I start the next thread meanwhile?"]').click()
  await expect(ask).toHaveCount(0)
  // Taking an answer back brings it back.
  await field.fill('')
  await expect(ask).toHaveText('5 questions unanswered')
})

test('answering never moves the buttons under the finger', async ({ page }) => {
  const { chat, ask } = await open(page, OMP_DECISIONS_PANE, 'Four decisions are waiting for you:')
  const panel = chat.locator('.q-table')
  await panel.scrollIntoViewIfNeeded()
  await expect(ask).toBeVisible()
  const field = await top(page, '.prompt')
  const before = await top(page, '.q-trow')
  await panel.getByRole('button', { name: '1 · Yes: Tag the release today?' }).click()
  await expect(ask).toHaveText('4 questions unanswered')
  expect(await top(page, '.q-trow')).toBe(before)
  // The reminder leaving does not move the field either.
  await panel.locator('.q-all').click()
  await chat.locator('.q-yes[data-q="Shall I start the next thread meanwhile?"]').click()
  await expect(ask).toHaveCount(0)
  expect(await top(page, '.prompt')).toBeLessThanOrEqual(field)
})

test('only the last message of the agent is counted, and a sent message clears it', async ({ page }, testInfo) => {
  const { chat, field, ask } = await open(page, OMP_FOLLOWUP_PANE, 'Review the plan.')
  // "Was the first draft fine?" belongs to an earlier message: never counted.
  // (An earlier project of this run may have left the agent's follow-up as the last message.)
  const fresh = await chat.getByText(FOLLOWUP_REPLY).count() === 0
  if (fresh) {
    await expect(ask).toHaveText('2 questions unanswered')
    // Words alone do not say which of the two they answer.
    await field.fill('Fine.')
    await expect(ask).toHaveText('2 questions unanswered')
    await field.fill('')
    await chat.locator('.q-yes[data-q="Shall I rename the module?"]').click()
    await expect(ask).toHaveText('1 question unanswered')
    await chat.locator('.q-reply[data-q="Which name do you prefer?"]').click()
    await expect(ask).toHaveCount(0)
    await page.keyboard.type('core')
  } else {
    await expect(ask).toHaveText('1 question unanswered')
    // One question only: any words answer it.
    await field.fill(`Yes (${testInfo.project.name})`)
    await expect(ask).toHaveCount(0)
  }
  const replies = await chat.getByText(FOLLOWUP_REPLY).count()
  await page.locator('.prompt-send').click()
  // Sent: the draft is empty again, and no reminder while the message is on its way.
  await expect(page.locator('.msg-pending')).toBeVisible()
  await expect(field).toHaveValue('')
  await expect(ask).toHaveCount(0)
  // The agent's new reply asks one thing: the reminder is about that one.
  await expect(chat.getByText(FOLLOWUP_REPLY)).toHaveCount(replies + 1)
  await expect(ask).toHaveText('1 question unanswered')
  await shot(page, 'unanswered-after-send', testInfo.project.name)
})

test('a reply that asks nothing has no reminder', async ({ page }) => {
  const { ask } = await open(page, COORDINATOR_PANE, 'Two threads are working.')
  await expect(page.locator('.prompt')).toBeVisible()
  await expect(ask).toHaveCount(0)
})
