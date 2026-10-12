import { expect, test, type Page } from '@playwright/test'
import { CODEX_UPDATE_PANE, COORDINATOR_PANE } from './scenario.mjs'

// Board: every project's TASKS.md tasks and threads, and every agent, in four
// columns. Moving a task card sends the coordinator the matching message; the
// coordinator edits TASKS.md, the card shows "Sent" meanwhile.
const task = (text: string) => ({ text, done: false, owner: 'agent', thread: null })
const board = {
  version: 'v1',
  projects: [{
    key: '|/home/user/.herdr-projects/acme',
    slug: 'acme',
    panes: [COORDINATOR_PANE],
    resolvedTotal: 0,
    board: {
      slug: 'acme',
      version: 'p1',
      lists: [
        { title: 'To decide', kind: 'decide', tasks: [task('Keep the old layout?')] },
        { title: 'To do', kind: 'todo', tasks: [task('Keyboard shortcuts help')] },
        { title: 'Backlog', kind: 'backlog', tasks: [task('Export to CSV')] },
      ],
      open: [],
      resolved: [],
    },
  }],
}

async function openBoard(page: Page, lang = 'en') {
  await page.addInitScript(l => localStorage.setItem('herdrLanguage', String(l)), lang)
  await page.route('**/api/board*', route => route.fulfill({ json: board }))
  const sent: { pane: string, text: string }[] = []
  page.on('request', (r) => {
    if (r.method() !== 'POST' || !/\/api\/(prompt|input)$/.test(new URL(r.url()).pathname)) return
    const body = r.postDataJSON() as { pane_id?: string, text?: string } | null
    sent.push({ pane: String(body?.pane_id ?? ''), text: String(body?.text ?? '') })
  })
  await page.goto('/#/board')
  await expect(page.locator('#board .board-card.task')).toHaveCount(3)
  // The phone shows one column at a time.
  const todo = page.locator('#board .board-seg').getByRole('button', { name: lang === 'en' ? /^Todo/ : /^À faire/ })
  if (await todo.isVisible()) await todo.click()
  return sent
}

const card = (page: Page, text: string) => page.locator('#board .board-card', { hasText: text })
// The move menu: a dropdown on a computer, a sheet of buttons on a phone.
const COLUMN = /^(Blocked|Todo|Ongoing|Finished|Bloqué|À faire|En cours|Terminé)$/
const choices = (page: Page) => page.getByRole('menuitem').or(page.locator('.hw-sheet').getByRole('button', { name: COLUMN }))

test('H opens the Board from the agent list on a computer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('phone'), 'keyboard shortcuts are for the computer layout')
  await page.route('**/api/board*', route => route.fulfill({ json: board }))
  await page.goto('/')
  await expect(page.locator('#home')).toBeVisible()
  await page.locator('body').press('h')
  await expect(page).toHaveURL(/#\/board$/)
  await expect(card(page, 'Keyboard shortcuts help')).toBeVisible()
})

test('Move to… sends the Project panel message to the coordinator', async ({ page }) => {
  const sent = await openBoard(page)
  // To decide waits for an answer: no move.
  await expect(card(page, 'Keep the old layout?').getByRole('button', { name: 'Move to…' })).toHaveCount(0)

  await card(page, 'Export to CSV').getByRole('button', { name: 'Move to…' }).click()
  // Only the other columns are offered.
  await expect(choices(page)).toHaveText(['Blocked', 'Ongoing', 'Finished'])
  await choices(page).filter({ hasText: 'Ongoing' }).click()

  await expect.poll(() => sent).toEqual([{ pane: COORDINATOR_PANE, text: '↳ Launch: Export to CSV' }])
  await expect(card(page, 'Export to CSV')).toContainText('Sent')
  await expect(card(page, 'Export to CSV').getByRole('button', { name: 'Move to…' })).toHaveCount(0)
})

test('a Board move in French', async ({ page }) => {
  const sent = await openBoard(page, 'fr')
  await card(page, 'Keyboard shortcuts help').getByRole('button', { name: 'Déplacer vers…' }).click()
  await choices(page).filter({ hasText: 'Terminé' }).click()
  await expect.poll(() => sent.map(s => s.text)).toEqual(['↳ Marquer fait : Keyboard shortcuts help'])
})

test('dragging a task card to another column moves it, the same column does nothing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('phone'), 'drag and drop is for the computer layout')
  const sent = await openBoard(page)
  const todo = card(page, 'Keyboard shortcuts help')
  await todo.dragTo(page.locator('#board .board-col.todo .board-col-body'))
  await todo.dragTo(page.locator('#board .board-col.blocked .board-col-body'))
  await expect.poll(() => sent.map(s => s.text)).toEqual(['↳ Mark blocked: Keyboard shortcuts help'])
  await expect(todo).toContainText('Sent')
})

test('the project filter narrows the Board to one project and is remembered', async ({ page }, testInfo) => {
  const phone = testInfo.project.name.includes('phone')
  const other = {
    key: '|/home/user/.herdr-projects/codex-update',
    slug: 'codex-update',
    panes: [CODEX_UPDATE_PANE],
    resolvedTotal: 0,
    board: { slug: 'codex-update', version: 'p2', lists: [{ title: 'To do', kind: 'todo', tasks: [task('Release notes')] }], open: [], resolved: [] },
  }
  await page.route('**/api/board*', route => route.fulfill({ json: { ...board, projects: [...board.projects, other] } }))
  await page.goto('/#/board')
  await expect(page.locator('#board .board-card.task')).toHaveCount(4)

  const filter = page.locator('#board .board-filter')
  await expect(filter).toHaveText('All projects')
  const pick = (name: string) => page.getByRole('menuitem', { name }).or(page.locator('.hw-sheet').getByRole('button', { name, exact: true }))
  if (phone) {
    await filter.click()
  } else {
    // Keyboard: the filter takes the focus and opens with Enter.
    await filter.focus()
    await page.keyboard.press('Enter')
  }
  await expect(pick('codex-update')).toBeVisible()
  await pick('acme').click()

  await expect(filter).toHaveText('acme')
  await expect(page.locator('#board .board-card.task')).toHaveCount(3)
  await expect(card(page, 'Release notes')).toHaveCount(0)
  await expect(page.locator('#board .board-card.project')).toHaveCount(1)
  if (phone) {
    // The filter fits the header; the column picker stays on screen and counts the project's cards.
    const width = page.viewportSize()!.width
    const box = (await filter.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    await expect(page.locator('#board .board-seg')).toBeInViewport({ ratio: 1 })
    await expect(page.locator('#board .board-seg-btn.todo b')).toHaveText('4')
  } else {
    await expect(page.locator('#board .board-col.todo .board-col-head .pp-count')).toHaveText('4')
  }

  // A task still moves under the filter.
  if (phone) await page.locator('#board .board-seg').getByRole('button', { name: /^Todo/ }).click()
  await card(page, 'Export to CSV').getByRole('button', { name: 'Move to…' }).click()
  await choices(page).filter({ hasText: 'Ongoing' }).click()
  await expect(card(page, 'Export to CSV')).toContainText('Sent')

  await page.reload()
  await expect(filter).toHaveText('acme')
  await expect(page.locator('#board .board-card.task')).toHaveCount(3)
})

