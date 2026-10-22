// Regressions reproduced by the independent t-0325 review.
import { readFileSync } from 'node:fs'
import { expect, test } from './test'
import { screenChoices } from '../../server/utils/choices'
import { OMP_CHAT_PANE as pane, fakeHerdr } from './scenario.mjs'

const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const show = (text: string | null, agent = 'codex', status = 'idle') =>
  fakeHerdr('e2e.interaction_screen', { pane_id: pane, text, agent, status })
const interaction = async (page: import('@playwright/test').Page) => {
  const state = await (await page.request.get('/api/state')).json()
  return state.panes.find((p: { id: string }) => p.id === pane)?.interaction
}
const shot = async (page: import('@playwright/test').Page, name: string, project: string) => {
  await page.addStyleTag({ content: '.agent-meta .where { visibility: hidden !important; }' })
  await page.screenshot({ path: `.shots/review0325-${name}-${project}.png` })
}

test.afterEach(async () => { await show(null, 'omp') })

test('the fallback closes when the agent starts working, and the composer returns', async ({ page }, info) => {
  await show(fx('codex-usage-menu.txt'))
  await page.goto(`/#/a/${pane}`)
  await expect(page.locator('.interactive-terminal')).toBeVisible()
  await show('• Working (12s • esc to interrupt)', 'codex', 'working')
  await expect.poll(() => interaction(page)).toBe('working')
  await page.goto('/#/')
  await page.goto(`/#/a/${pane}`)
  await page.waitForTimeout(2500)
  await shot(page, 'working', info.project.name)
  expect(await fakeHerdr('e2e.pane_size', { pane_id: pane })).toMatchObject({ attached: false })
  await expect(page.locator('.interactive-terminal')).toHaveCount(0)
  await expect(page.locator('.composer')).toBeVisible()
})

test('a native approval keeps its card when the screen also quotes an exception title', async ({ page }, info) => {
  await show(`Agent Command Center\n\n${fx('claude-approve-bash.txt')}`, 'claude', 'blocked')
  await page.goto(`/#/a/${pane}`)
  await expect.poll(() => interaction(page)).not.toBe('input')
  await page.waitForTimeout(1500)
  await shot(page, 'exception', info.project.name)
  await expect(page.locator('.choices-list')).toBeVisible()
  await expect(page.locator('.interactive-terminal')).toHaveCount(0)
})

test('a closed agent at its shell prompt keeps the conversation and its composer', async ({ page }, info) => {
  await show('Resume this session with:\nclaude --resume 00000000-0000-4000-8000-000000000000\nuser@host demo % ', 'claude', 'unknown')
  await page.goto(`/#/a/${pane}`)
  // Wait for the server's verdict before checking the rendered view.
  await expect.poll(() => interaction(page)).not.toBe('input')
  await page.waitForTimeout(1500)
  await shot(page, 'closed-agent', info.project.name)
  expect(await fakeHerdr('e2e.pane_size', { pane_id: pane })).toMatchObject({ attached: false })
  await expect(page.locator('.interactive-terminal')).toHaveCount(0)
  await expect(page.locator('.composer')).toBeVisible()
})

test('Codex approvals below quoted old menus keep their native card and accept answers', async ({ page }) => {
  for (const [file, quote] of [
    ['codex-approve-command.txt', 'Agent Command Center'],
    ['codex-approve-edits.txt', fx('codex-command-center.txt')],
    ['codex-approve-command.txt', fx('codex-usage-menu.txt')],
  ]) {
    const text = `${quote}\n\n${fx(file!)}`
    await show(text, 'codex', 'blocked')
    await page.goto(`/#/a/${pane}`)
    await expect.poll(() => interaction(page)).toBe('native')
    await expect(page.locator('.choices-list')).toBeVisible()
    await expect(page.locator('.interactive-terminal')).toHaveCount(0)
    const prompt = screenChoices(text, 'codex')!
    const response = await page.request.post('/api/choose', {
      headers: { Origin: new URL(page.url()).origin },
      data: { pane_id: pane, index: 0, label: prompt.options[0]!.label, identity: prompt.identity },
    })
    expect(response.ok()).toBe(true)
  }
})

test('a starting unknown Codex discovers a trust card drawn after its first empty read', async ({ page }) => {
  await show('', 'codex', 'unknown')
  await page.goto(`/#/a/${pane}`)
  await expect.poll(() => interaction(page)).toBe('unknown')
  await page.waitForTimeout(2000)
  await show(fx('codex-trust.txt'), 'codex', 'unknown')
  await expect.poll(() => interaction(page)).toBe('native')
  await expect(page.locator('.choices')).toBeVisible()
  await expect(page.locator('.interactive-terminal')).toHaveCount(0)
})
