import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { CLAUDE_ASK_PANE, CLAUDE_PANE, OMP_ASK_PANE, SPLIT_CHAT_PANE, fakeHerdr } from './scenario.mjs'

// Compact list (the default): the card of an agent waiting for an answer opens
// on its question and the one-tap answers of the detailed card, and is one
// line again once answered.
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()
const fx = (name: string) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const APPROVAL = fx('omp-approve-bash.txt')
const LONG_ASK = fx('claude-ask-long.txt')

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
  await ask(CLAUDE_ASK_PANE, LONG_ASK)
  await expect(claude).toHaveClass(/open/)
  await expect(claude.locator('.card-choices button .l')).toHaveText(['Keep the current cache (Recommended)', 'Move everything to the database', 'Split by data type', 'Chat about this'])
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

test('a tap that lands on the answers the moment they appear is ignored', async ({ page }) => {
  await page.goto('/')
  const omp = card(page, OMP_ASK_PANE)
  await expect(omp).toHaveClass(/compact/)
  await expect(opened(page)).toHaveCount(0)
  // The list has been on screen for a while.
  await page.waitForTimeout(1200)
  // A finger on its way to a line: it lands in the frame the answers of the
  // agent above appear, on the first of them.
  await page.evaluate((pane) => {
    const w = window as unknown as { tapped?: boolean }
    const seen = new MutationObserver(() => {
      const b = document.querySelector<HTMLElement>(`#home .card[data-pane="${pane}"] .card-choices button`)
      if (!b) return
      seen.disconnect()
      b.click()
      w.tapped = true
    })
    seen.observe(document.querySelector('#home')!, { childList: true, subtree: true })
  }, OMP_ASK_PANE)
  await ask(OMP_ASK_PANE, APPROVAL)
  await expect.poll(() => page.evaluate(() => (window as unknown as { tapped?: boolean }).tapped)).toBe(true)
  await page.waitForTimeout(700)
  // Nothing answered, nothing opened: the question still waits.
  expect(await answers(OMP_ASK_PANE)).toEqual([])
  await expect(omp).toHaveClass(/open/)
  await expect(omp.locator('.card-choices button').first()).toBeEnabled()
  await expect(page).toHaveURL(/\/$|#\/$/)
  // A moment later the same answer takes the tap.
  await omp.locator('.card-choices button', { hasText: 'Approve' }).click()
  await expect.poll(() => answers(OMP_ASK_PANE)).toEqual([['enter']])
})

test('open cards do not replay their opening when the list comes back', async ({ page }) => {
  await ask(OMP_ASK_PANE, APPROVAL)
  await page.goto('/')
  const more = card(page, OMP_ASK_PANE).locator('.card-more')
  await expect(more).toBeVisible()
  // The list has been on screen for a while.
  await page.waitForTimeout(1200)
  // Counts the answers that enter the page with the opening transition.
  await page.evaluate(() => {
    const w = window as unknown as { openings: number }
    w.openings = 0
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue
        w.openings += [n, ...n.querySelectorAll('.card-more')].filter(el => el.matches('.card-more.card-more-enter-active')).length
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
  const openings = () => page.evaluate(() => (window as unknown as { openings: number }).openings)
  // A conversation and back (on a phone the list leaves the screen meanwhile).
  await page.goto(`/#/a/${CLAUDE_PANE}`)
  await expect(page.locator('.prompt textarea')).toBeVisible()
  await page.goBack()
  await expect(more).toBeVisible()
  await page.waitForTimeout(300)
  expect(await openings()).toBe(0)
  // An agent that starts waiting while the list is shown still opens with it.
  await page.waitForTimeout(1000)
  await ask(CLAUDE_ASK_PANE, LONG_ASK)
  await expect(card(page, CLAUDE_ASK_PANE)).toHaveClass(/open/)
  expect(await openings()).toBe(1)
})

test('a space with several panes says which pane asks, as the detailed card does', async ({ page }, testInfo) => {
  await ask(SPLIT_CHAT_PANE, APPROVAL)
  try {
    await page.goto('/')
    const space = page.locator('#home .card[data-ws="w9"]')
    await expect(space).toHaveClass(/compact/)
    await expect(space).toHaveClass(/open/)
    const where = space.locator('.card-more .card-where')
    await expect(where).toBeVisible()
    // On the mini-map of the tab, and by name (this pane has no title: its agent).
    await expect(where.locator('.tabmap i')).toHaveCount(2)
    await expect(where.locator('.tabmap i.cur')).toHaveCount(1)
    expect(await where.locator('.tabmap i').first().evaluate(el => el.classList.contains('cur'))).toBe(true)
    expect((await where.innerText()).trim()).toBe('omp')
    // Above the question, inside the card.
    const [w, q, host] = await Promise.all([where.boundingBox(), space.locator('.card-preview').boundingBox(), space.boundingBox()])
    expect(w!.y + w!.height).toBeLessThanOrEqual(q!.y + 1)
    expect(w!.x + w!.width).toBeLessThanOrEqual(host!.x + host!.width)
    await shot(page, 'compact-space-where', testInfo.project.name)
    // A space of one pane has nothing to tell apart.
    await ask(OMP_ASK_PANE, APPROVAL)
    await expect(card(page, OMP_ASK_PANE)).toHaveClass(/open/)
    await expect(card(page, OMP_ASK_PANE).locator('.card-where')).toHaveCount(0)
    // The detailed card points at the same pane on its own mini-map.
    await page.evaluate(() => localStorage.setItem('compactList', '0'))
    await page.reload()
    await expect(space).not.toHaveClass(/compact/)
    expect(await space.locator('.space-avatar .tabmap i').first().evaluate(el => el.classList.contains('cur'))).toBe(true)
  } finally { await ask(SPLIT_CHAT_PANE) }
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
