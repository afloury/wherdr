import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { CLAUDE_ASK_PANE, CLAUDE_PANE, OMP_ASK_PANE, fakeHerdr } from './scenario.mjs'

// Compact list (the default): the card of an agent waiting for an answer opens
// on its question and the one-tap answers of the detailed card, and is one
// line again once answered.
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()
const fx = (name: string) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const APPROVAL = fx('omp-approve-bash.txt')
const LONG_ASK = fx('claude-ask-long.txt')
// The long question still fits native controls when its options are a single,
// continuous column without descriptions or a special free-answer entry.
const SIMPLE_ASK = LONG_ASK.slice(0, LONG_ASK.indexOf('❯ 1.')) + [
  '❯ 1. Keep the current cache (Recommended)',
  '  2. Move everything to the database',
  '  3. Split by data type',
  '', 'Enter to select · ↑/↓ to navigate · Esc to cancel',
].join('\n')

const card = (page: Page, pane: string) => page.locator(`#home .card[data-pane="${pane}"]`)
const height = (page: Page, pane: string) => card(page, pane).evaluate(el => el.getBoundingClientRect().height)
const ask = (pane: string, screen?: string) => fakeHerdr('e2e.ask', { pane_id: pane, screen })
const answers = async (pane: string) => (await fakeHerdr('e2e.answers', { pane_id: pane })).answers
// Among the agents of this spec (other specs may leave one of theirs waiting).
const opened = (page: Page) => page.locator(['.open', ':has(.card-more)'].flatMap(s => [OMP_ASK_PANE, CLAUDE_ASK_PANE, CLAUDE_PANE].map(p => `#home .card[data-pane="${p}"]${s}`)).join(', '))

test.beforeEach(async () => {
  await ask(OMP_ASK_PANE)
  await ask(CLAUDE_ASK_PANE)
})
test.afterEach(async () => {
  await ask(OMP_ASK_PANE)
  await ask(CLAUDE_ASK_PANE)
})

test('a waiting agent opens its compact card; one tap answers and folds it back', async ({ page }, testInfo) => {
  await page.goto('/')
  const omp = card(page, OMP_ASK_PANE)
  const claude = card(page, CLAUDE_ASK_PANE)
  await expect(omp).toHaveClass(/compact/)
  // Not waiting: one line, no answers.
  await expect(opened(page)).toHaveCount(0)
  const line = await height(page, OMP_ASK_PANE)
  expect(line).toBeLessThan(44)

  await ask(OMP_ASK_PANE, APPROVAL)
  await expect(omp).toHaveClass(/open/)
  await expect(omp.locator('.card-detail')).toContainText('echo hello > out.txt')
  await expect(omp.locator('.card-preview')).toHaveText('Allow tool: bash')
  await expect(omp.locator('.card-choices button .l')).toHaveText(['Approve', 'Deny'])
  // The other agents keep their line.
  await expect(opened(page)).toHaveCount(1)
  expect(await height(page, CLAUDE_PANE)).toBe(line)

  // A second agent waits at the same time: both cards are open.
  await ask(CLAUDE_ASK_PANE, SIMPLE_ASK)
  await expect(claude).toHaveClass(/open/)
  await expect(claude.locator('.card-choices button .l')).toHaveText(['Keep the current cache (Recommended)', 'Move everything to the database', 'Split by data type'])
  await expect(opened(page)).toHaveCount(2)
  // A long question is cut after two lines, and nothing widens the list.
  const preview = claude.locator('.card-preview')
  await expect(preview).toContainText('Which of these approaches')
  expect(await preview.evaluate(el => el.getBoundingClientRect().height <= 2 * parseFloat(getComputedStyle(el).lineHeight) + 1 && el.scrollHeight > el.clientHeight)).toBe(true)
  expect(await page.locator('#home .scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  for (const b of await omp.locator('.card-choices button').all()) {
    const box = (await b.boundingBox())!
    const host = (await omp.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(host.x + host.width)
  }
  await claude.scrollIntoViewIfNeeded()
  await shot(page, 'compact-blocked', testInfo.project.name)

  // One tap answers, without opening the conversation.
  await omp.locator('.card-choices button', { hasText: 'Approve' }).click()
  await expect.poll(() => answers(OMP_ASK_PANE)).toEqual([['enter']])
  await expect(omp).not.toHaveClass(/open/)
  await expect(omp.locator('.card-more')).toHaveCount(0)
  expect(await height(page, OMP_ASK_PANE)).toBe(line)
  await expect(page).toHaveURL(/\/$|#\/$/)
  // The other waiting agent is still open, and takes its own answer.
  await expect(claude).toHaveClass(/open/)
  await claude.locator('.card-choices button', { hasText: 'Move everything' }).click()
  await expect.poll(() => answers(CLAUDE_ASK_PANE)).toEqual([['down', 'enter']])
  await expect(opened(page)).toHaveCount(0)
  await shot(page, 'compact-answered', testInfo.project.name)
})

test('the answers open with a transition, off under reduced motion', async ({ page }) => {
  await ask(OMP_ASK_PANE, APPROVAL)
  const duration = async () => {
    await page.goto('/')
    const more = card(page, OMP_ASK_PANE).locator('.card-more')
    await expect(more).toBeVisible()
    return more.evaluate((el) => {
      el.classList.add('card-more-enter-active')
      return Math.max(...getComputedStyle(el).transitionDuration.split(',').map(parseFloat))
    })
  }
  expect(await duration()).toBeGreaterThan(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await duration()).toBe(0)
})

test('an ambiguous question opens its compact card with access to the live terminal', async ({ page }) => {
  await ask(CLAUDE_ASK_PANE, LONG_ASK)
  await page.goto('/')
  const claude = card(page, CLAUDE_ASK_PANE)
  await expect(claude).toHaveClass(/open/)
  await expect(claude.locator('.card-preview')).toHaveText('Interactive agent screen')
  await expect(claude.locator('.card-choices button')).toHaveCount(1)
  await claude.getByRole('button', { name: 'Open interactive terminal' }).click()
  const window = page.getByRole('region', { name: 'Interactive terminal', exact: true })
  await expect(window).toBeVisible()
  await expect(page.locator('.choices')).toHaveCount(0)
  expect(await answers(CLAUDE_ASK_PANE)).toEqual([])
  await window.getByRole('button', { name: 'Close terminal window' }).click()
  await expect(window).toHaveCount(0)
  await page.goto('/')
  // The card explicitly reopens a manually dismissed interaction.
  await card(page, CLAUDE_ASK_PANE).getByRole('button', { name: 'Open interactive terminal' }).click()
  await expect(window).toBeVisible()
})

test('detailed list: a waiting agent keeps its detailed card and answers', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('compactList', '0'))
  await ask(OMP_ASK_PANE, APPROVAL)
  await page.goto('/')
  const omp = card(page, OMP_ASK_PANE)
  await expect(omp.locator('.card-choices button .l')).toHaveText(['Approve', 'Deny'])
  await expect(omp).not.toHaveClass(/compact|open/)
  await expect(omp.locator('.card-meta')).toBeVisible()
  // The answers stay under the title, as before.
  const [title, choices] = await Promise.all([omp.locator('.card-title').boundingBox(), omp.locator('.card-choices').boundingBox()])
  expect(Math.abs(choices!.x - title!.x)).toBeLessThanOrEqual(1)
  await shot(page, 'detailed-blocked', testInfo.project.name)
  await omp.locator('.card-choices button', { hasText: 'Deny' }).click()
  await expect.poll(() => answers(OMP_ASK_PANE)).toEqual([['down', 'enter']])
  await expect(omp.locator('.card-choices')).toHaveCount(0)
})
