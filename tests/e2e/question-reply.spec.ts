import { expect, test, type Page } from '@playwright/test'
import { OMP_QUESTIONS_PANE } from './scenario.mjs'

// "↳ Reply" after each question of an agent reply, wherever the question sits
// in its paragraph; a tap quotes the question alone in the field.
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

const STEP = 'Shall I start step 1 now?'
const TAG = 'Shall I tag the release today?'
const REVIEW = 'Or do you want a review first?'
const ETAPE = 'Je lance l’étape 1 maintenant ?'
const NOTES = 'Dernier point : je publie les notes de version ?'

test('a question in the middle of a paragraph gets its own Reply button', async ({ page }, testInfo) => {
  // No typewriter: the replies are read as they will stay.
  await page.addInitScript(() => localStorage.setItem('typewriterSpeed', 'off'))
  await page.goto(`/#/a/${OMP_QUESTIONS_PANE}`)
  const chat = page.locator('.chat')
  await expect(chat.getByText('A slot is free on the server.')).toBeVisible()

  // One button per question, in reading order; none for the title, the quoted
  // words, the URL or the code.
  const buttons = chat.locator('.q-reply')
  await expect(buttons).toHaveCount(5)
  expect(await buttons.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.q))).toEqual([STEP, TAG, REVIEW, ETAPE, NOTES])

  // The button sits right after its question, before the sentence that follows.
  const step = chat.locator(`.q-reply[data-q="${STEP}"]`)
  expect(await step.evaluate(el => [el.previousSibling?.textContent, el.nextSibling?.textContent])).toEqual([
    'I added the task to the queue, to be confirmed. Shall I start step 1 now?',
    ' A slot is free on the server.',
  ])
  await step.scrollIntoViewIfNeeded()
  await shot(page, 'questions', testInfo.project.name)

  // A tap quotes the question alone, then the next one below it.
  const field = page.locator('.prompt textarea').first()
  await step.click()
  await expect(field).toHaveValue(`> ${STEP}\n`)
  await expect(step).toHaveClass(/quoted/)
  await chat.locator(`.q-reply[data-q="${REVIEW}"]`).click()
  await expect(field).toHaveValue(`> ${STEP}\n\n> ${REVIEW}\n`)
  await chat.locator(`.q-reply[data-q="${ETAPE}"]`).click()
  await expect(field).toHaveValue(`> ${STEP}\n\n> ${REVIEW}\n\n> ${ETAPE}\n`)
  await expect(chat.locator('.q-reply.quoted')).toHaveCount(3)
  await shot(page, 'questions-quoted', testInfo.project.name)
})
