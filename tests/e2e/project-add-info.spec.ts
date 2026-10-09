import { expect, test, type Page } from '@playwright/test'
import { COORDINATOR_PANE } from './scenario.mjs'

// Project panel › In progress › Add info: a text sheet whose content is sent to
// the coordinator as "↳ Info for t-NNNN: …", for it to pass on to the thread.
const thread = (id: string, title: string, percent: number) => ({
  id, title, group: 'Working', token: 'working', rank: 4, resolved: false, updated: '', created: '',
  agentName: null, machine: '', activity: 'Writing tests', percent, pr: '', report: false,
})
const board = {
  slug: 'acme',
  version: 'v1',
  lists: [
    { title: 'In progress', kind: 'doing', tasks: [
      { text: 'Per-key rate limits', done: false, owner: 'agent → t-0012', thread: 't-0012' },
      { text: 'Search in the invoice list', done: false, owner: 'agent → t-0014', thread: 't-0014' },
    ] },
    { title: 'Backlog', kind: 'backlog', tasks: [{ text: 'Export to CSV', done: false, owner: 'agent', thread: null }] },
  ],
  open: [thread('t-0012', 'Per-key rate limits', 60)],
  resolved: [],
}

const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

async function openPanel(page: Page, lang = 'en') {
  await page.addInitScript(([pane, l]) => {
    localStorage.setItem('herdrLanguage', String(l))
    // The phone shows the panel as a tab of the coordinator.
    localStorage.setItem('viewModes', JSON.stringify({ [String(pane)]: 'project' }))
  }, [COORDINATOR_PANE, lang] as const)
  await page.route('**/api/project?**', route => route.fulfill({ json: board }))
  const sent: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/(prompt|input)$/.test(new URL(r.url()).pathname)) sent.push(String(r.postDataJSON()?.text ?? ''))
  })
  await page.goto(`/#/a/${COORDINATOR_PANE}`)
  await expect(page.locator('.project-panel .pp-card')).toContainText('Per-key rate limits')
  return sent
}

test('Add info sends the typed text to the coordinator, for the thread', async ({ page }, testInfo) => {
  const sent = await openPanel(page)
  await shot(page, 'add-info-panel', testInfo.project.name)

  await page.getByRole('button', { name: 'Add info: Per-key rate limits' }).click()
  const sheet = page.locator('.hw-sheet')
  await expect(sheet).toContainText('T-0012')
  const send = sheet.getByRole('button', { name: 'Send' })
  await expect(send).toBeDisabled()
  const field = sheet.locator('textarea')
  await expect(field).toBeFocused()
  await field.fill('The limit is per API key, not per user.\nKeep the 429 body as it is.')
  await shot(page, 'add-info-sheet', testInfo.project.name)
  await send.click()

  await expect(sheet).toHaveCount(0)
  await expect.poll(() => sent).toEqual(['↳ Info for t-0012: The limit is per API key, not per user.\nKeep the 429 body as it is.'])
  await expect(page.getByText('Sent to the coordinator').first()).toBeVisible()
  await shot(page, 'add-info-sent', testInfo.project.name)
})

test('Add info on the task of a thread without a card, in French', async ({ page }) => {
  const sent = await openPanel(page, 'fr')
  await page.getByRole('button', { name: 'Ajouter une info : Search in the invoice list' }).click()
  const sheet = page.locator('.hw-sheet')
  await expect(sheet).toContainText('T-0014')
  await sheet.locator('textarea').fill('Filtre aussi par client')
  await sheet.getByRole('button', { name: 'Envoyer' }).click()
  await expect.poll(() => sent).toEqual(['↳ Info pour t-0014 : Filtre aussi par client'])
})

test('cancelling Add info composes nothing', async ({ page }) => {
  const sent = await openPanel(page)
  await page.getByRole('button', { name: 'Add info: Per-key rate limits' }).click()
  const sheet = page.locator('.hw-sheet')
  await sheet.locator('textarea').fill('Never mind')
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await expect(sheet).toHaveCount(0)
  // Nothing sent, and nothing put into the coordinator's message field.
  const composer = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  if (await composer.count()) await expect(composer).toHaveText('')
  expect(sent).toEqual([])
})
