import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { OMP_CHAT_PANE as pane, fakeHerdr } from './scenario.mjs'
const fx = (kind: string) => readFileSync(new URL(`../fixtures/claude-limit-${kind}.txt`, import.meta.url), 'utf8')
const show = (text: string | null, status = 'blocked') => fakeHerdr('e2e.interaction_screen', { pane_id: pane, text, agent: 'claude', status })
test.afterEach(async () => { await show(null, 'idle') })

test('quota waits stay in conversation with a usable draft and native actions', async ({ page }, info) => {
  test.setTimeout(60_000)
  await show(fx('weekly'))
  await page.goto(`/#/a/${pane}`)
  const card = page.locator('.usage-limit-card')
  await expect(card).toContainText('11pm')
  await expect(card).toContainText('Will continue automatically')
  await expect(page.locator('.interactive-terminal')).toHaveCount(0)
  await expect(page.locator('.chat')).toBeVisible()
  await expect.poll(async () => {
    const state = await (await page.request.get('/api/state')).json()
    const p = state.panes.find((p: { id: string }) => p.id === pane)
    return { status: p.status, interaction: p.interaction, prompt: p.prompt ?? null }
  }).toEqual({ status: 'idle', interaction: 'native', prompt: null })
  if ((page.viewportSize()?.width || 0) > 768) {
    await expect(page.locator(`.card[data-pane="${pane}"] .quota-limit`)).toHaveText('Limit')
  }
  const field = page.locator('.composer textarea')
  await field.fill('Continue when available')
  await expect(field).toBeEnabled()
  await expect(card.locator('a')).toHaveAttribute('href', 'https://clau.de/reset')
  await page.screenshot({ path: `.shots/usage-limit-${info.project.name}.png` })
  await card.getByRole('button', { name: 'Cancel wait', exact: true }).click()
  await expect.poll(async () => (await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).keys).toContain('esc')
  await expect(field).toHaveValue('Continue when available')
  await expect(card).toHaveCount(0)
  await show(fx('weekly'))
  await expect(card).toBeVisible()
  // Let the agent open its own credits choices; do not submit the draft or open a result sheet.
  const sent: string[] = []
  await page.route('**/api/prompt', async route => {
    sent.push(route.request().postDataJSON().text)
    await route.fulfill({ json: { ok: true } })
  })
  await card.getByRole('button', { name: '/usage-credits', exact: true }).click()
  await expect.poll(() => sent).toEqual(['/usage-credits'])
  await expect(page.locator('.hw-sheet')).toHaveCount(0)
  await show(fx('session'))
  await expect(card).toContainText('3pm')
  await expect(card.locator('a')).toHaveCount(0)
  // Even with an unchanged idle revision, the wait disappears after reset.
  await show(fx('session').replace(/  ⚠ Usage limit reached[^]*$/, '  ? for shortcuts'), 'idle')
  await expect(card).toHaveCount(0)
  await expect(field).toHaveValue('Continue when available')
  await expect(page.locator('.interactive-terminal')).toHaveCount(0)
})
