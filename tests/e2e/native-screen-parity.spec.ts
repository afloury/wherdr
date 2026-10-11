import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { parseChoices, parseOmpPrompt } from '../../server/utils/choices'
import { parseMenu } from '../../shared/menuScreen'
import { parseWaitScreen } from '../../server/utils/waitScreen'
import { OMP_CHAT_PANE as pane, fakeHerdr } from './scenario.mjs'

const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const show = (name: string | null, agent = 'omp', status = 'idle') =>
  fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: name ? fx(name) : null, agent, status })

test.afterEach(async () => { await show(null) })

test('native questions, menus and waiting screens keep their cards in conversation', async ({ page }, info) => {
  test.setTimeout(90_000)
  const cases = [
    ['claude-ask-long.txt', 'claude', 'blocked', '.choices-list'],
    ['claude-ask-multi.txt', 'claude', 'blocked', '.choices-list.multi'],
    ['claude-ask-tabs-1.txt', 'claude', 'blocked', '.choices-list'],
    ['omp-ask-single.txt', 'omp', 'blocked', '.choices-list'],
    ['omp-ask-multi.txt', 'omp', 'blocked', '.choices-list.multi'],
    ['omp-ask-tabs.ansi', 'omp', 'blocked', '.choices-tabs'],
    ['claude-resume.ansi', 'claude', 'idle', '.choices-menu'],
    ['claude-resume-all.ansi', 'claude', 'idle', '.choices-menu'],
    ['claude-model-1.txt', 'claude', 'idle', '.choices-menu'],
    // main retains this as kind=other; an existing conversation keeps its composer.
    ['claude-effort-medium.txt', 'claude', 'idle', '.composer'],
    ['codex-login.txt', 'codex', 'idle', '.choices'],
    ['codex-hooks-box.txt', 'codex', 'idle', '.choices-screen'],
    ['claude-security-guide.txt', 'claude', 'blocked', '.choices'],
    ['codex-approve-edits.txt', 'codex', 'blocked', '.choices-list'],
  ] as const
  await show('claude-ask-long.txt', 'claude', 'blocked')
  await page.goto(`/#/a/${pane}`)
  for (const [file, agent, status, selector] of cases) {
    await test.step(file, async () => {
      await show(file, agent, status)
      const text = fx(file).replace(/\x1b\[[0-9;]*m|\r/g, '')
      const prompt = agent === 'omp' ? parseOmpPrompt(text) : parseChoices(text, { strict: status !== 'blocked' })
      const menu = agent === 'claude' && status === 'idle' ? parseMenu(fx(file)) : null
      const wait = parseWaitScreen(text, { choices: Boolean(prompt) })
      await expect.poll(async () => {
        const state = await (await page.request.get('/api/state')).json()
        const current = state.panes.find((p: { id: string }) => p.id === pane)
        return { interaction: current?.interaction, question: current?.prompt?.question ?? null, title: current?.menu?.title ?? current?.screen?.title ?? null }
      }).toEqual({ interaction: 'native', question: menu ? null : prompt?.question ?? null, title: menu?.title ?? wait?.title ?? null })
      await expect(page.locator(selector)).toBeVisible()
      await expect(page.locator('.interactive-terminal')).toHaveCount(0)
      if (file === 'claude-ask-long.txt') await page.screenshot({ path: `.shots/native-question-${info.project.name}.png` })
    })
  }
})

test('Claude usage keeps the immediate loading sheet and native settings tabs', async ({ page }) => {
  await show('claude-idle.txt', 'claude')
  // The previous case ended on a blocked Codex question. Wait for the server
  // to publish Claude's idle field before a fresh page can receive that state;
  // otherwise /usage is sent through the previous question's /api/input route.
  await expect.poll(async () => {
    const state = await (await page.request.get('/api/state')).json()
    const current = state.panes.find((p: { id: string }) => p.id === pane)
    return { agent: current?.agent, prompt: current?.prompt ?? null, interaction: current?.interaction }
  }).toEqual({ agent: 'claude', prompt: null, interaction: 'input' })
  await page.goto(`/#/a/${pane}`)
  const field = page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()
  await field.fill('/usage')
  await page.route('**/api/prompt', async route => {
    const response = await route.fetch()
    await show('claude-settings-usage.ansi', 'claude')
    await route.fulfill({ response })
  })
  // Hold the first result read: the original built-in loading state must open
  // before any screen response. It used to be delayed by the fallback change.
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  await page.route('**/api/screen?*', async route => { await held; await route.continue() })
  await page.locator('.slash-menu .slash-item', { hasText: '/usage' }).first().click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.hw-sheet .spinner')).toBeVisible()
  release()
  await expect(page.locator('.cmd-tabs')).toBeVisible()
  await expect(page.locator('.cmd-tabs [role="tab"]')).toHaveText(['Status', 'Config', 'Usage', 'Stats'])
  await expect(page.locator('.interactive-terminal')).toHaveCount(0)
  const result = await (await page.request.get(`/api/screen?pane=${encodeURIComponent(pane)}`)).json()
  expect(result.interaction).toBe('native')
  expect(result.tabs).toEqual(['Status', 'Config', 'Usage', 'Stats'])
})
