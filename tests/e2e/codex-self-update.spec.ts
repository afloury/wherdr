import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { CODEX_UPDATE_PANE, CODEX_UPDATE_SESSION, SOCK_FILE, fakeHerdr } from './scenario.mjs'

const card = (page: Page) => page.locator('.choices')
async function stopAfterUpdate(page: Page, existing = false, question = 'Codex updated itself and stopped') {
  const { pid } = await fakeHerdr('e2e.update_reset', { pane_id: CODEX_UPDATE_PANE, ...(existing ? { session: CODEX_UPDATE_SESSION } : {}) })
  await page.goto(`/#/a/${CODEX_UPDATE_PANE}`)
  // Wait for wherdr to capture this invocation's argv and conversation.
  await expect.poll(() => {
    try {
      const records = JSON.parse(fs.readFileSync(path.join(path.dirname(SOCK_FILE), 'data/last-agents.json'), 'utf8'))
      return records.find(([id]: [string]) => id === CODEX_UPDATE_PANE)?.[1]
    } catch { return null }
  }).toMatchObject({ pid, conversation: existing ? 'existing' : 'empty', ...(existing ? { session: CODEX_UPDATE_SESSION } : {}) })
  if (existing) await expect(page.locator('.chat').getByText('The build passes.')).toBeVisible()
  await fakeHerdr('e2e.update_exit', { pane_id: CODEX_UPDATE_PANE })
  await expect(card(page).getByText(question)).toBeVisible()
}

test('a new Codex restarts with its original options, only after a tap', async ({ page }, info) => {
  await stopAfterUpdate(page)
  const button = card(page).getByRole('button', { name: 'Restart Codex', exact: false })
  await expect(button).toBeVisible()
  await expect(page.locator('.prompt textarea')).toBeDisabled()
  expect((await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts).toEqual([])
  if (info.project.name.startsWith('chromium')) {
    await page.screenshot({ path: `.shots/codex-update-${info.project.name}.png`, fullPage: true })
  }
  await button.click()
  await expect.poll(async () => (await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts.length).toBe(1)
  const { starts } = await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })
  expect(starts[0]).toMatchObject({ kind: 'codex', pane_id: CODEX_UPDATE_PANE, args: ['--profile', 'work', '-m', 'gpt-x'] })
  await expect(card(page)).toHaveCount(0)
})

test('an existing Codex resumes its exact session', async ({ page }) => {
  await stopAfterUpdate(page, true)
  await expect(card(page).getByRole('button', { name: /Start fresh/ })).toBeVisible()
  await card(page).getByRole('button', { name: /Resume conversation/ }).click()
  await expect.poll(async () => (await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts.length).toBe(1)
  const { starts } = await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })
  expect(starts[0].args).toEqual(['resume', '--profile', 'work', '-m', 'gpt-x', CODEX_UPDATE_SESSION])
})

test('an existing conversation can explicitly start fresh', async ({ page }) => {
  await stopAfterUpdate(page, true)
  await card(page).getByRole('button', { name: /Start fresh/ }).click()
  await expect.poll(async () => (await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts.length).toBe(1)
  const { starts } = await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })
  expect(starts[0].args).toEqual(['--profile', 'work', '-m', 'gpt-x'])
})

test('the restart card and both conversation choices are translated into French', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('herdrLanguage', 'fr'))
  await stopAfterUpdate(page, true, 'Codex s’est mis à jour et s’est arrêté')
  await expect(card(page).getByRole('button', { name: /Reprendre la conversation/ })).toBeVisible()
  await expect(card(page).getByRole('button', { name: /Démarrer une nouvelle conversation/ })).toBeVisible()
  if (info.project.name.startsWith('chromium')) await page.screenshot({ path: `.shots/codex-update-fr-${info.project.name}.png`, fullPage: true })
})

test('a shell draft refuses restart and keyboard navigation sends nothing', async ({ page }) => {
  await stopAfterUpdate(page)
  await fakeHerdr('e2e.update_draft', { pane_id: CODEX_UPDATE_PANE, text: 'echo hello' })
  const response = page.waitForResponse(r => r.url().endsWith('/api/choose'))
  await card(page).getByRole('button', { name: /Restart Codex/ }).click()
  expect((await response).status()).toBe(400)
  expect((await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts).toEqual([])
  const nav = await page.request.post('/api/nav', { headers: { Origin: new URL(page.url()).origin }, data: { pane_id: CODEX_UPDATE_PANE, key: 'enter' } })
  expect(nav.status()).toBe(400)
})

test('another foreground program refuses restart', async ({ page }) => {
  await stopAfterUpdate(page)
  await fakeHerdr('e2e.update_foreground', { pane_id: CODEX_UPDATE_PANE })
  const response = page.waitForResponse(r => r.url().endsWith('/api/choose'))
  await card(page).getByRole('button', { name: /Restart Codex/ }).click()
  expect((await response).status()).toBe(400)
  expect((await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts).toEqual([])
})
