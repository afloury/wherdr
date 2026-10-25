import { expect, test } from './test'
import fs from 'node:fs/promises'

for (const kind of ['time', 'tokens']) {
  test(`work ${kind} limit: explicit choice, cancellation, errors and refresh`, async ({ page }) => {
    const row = { id: 'demo/98', repo: 'demo', repoKey: 'DEMO', n: 98, state: 'blocked', kind: '', stage: 'stopped', title: 'Prepare the garden', app: 'codex', group: 'needs', msg: 'Stopped at a work limit' }
    let resumed = false
    let reads = 0
    const commands: unknown[] = []
    let refuse = true
    let release: (() => void) | undefined
    await page.route('**/api/tasks**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/tasks') return route.fulfill({ json: { machines: [{ machine: 'remote', status: 'ready', version: '1.2.16', tasks: [resumed ? { ...row, state: 'working', stage: 'working', group: 'working' } : row] }] } })
      if (url.pathname === '/api/tasks/details') {
        reads++
        return route.fulfill({ json: { ...row, ...(resumed ? { stage: 'working', state: 'working' } : {}), pane: null, limits: { time: kind === 'time' ? '2h' : 'none', timeUsed: '2h', tokens: kind === 'tokens' ? '2m' : 'none', tokensUsed: 2000000, stopped: kind } } })
      }
      if (route.request().method() === 'POST') commands.push(route.request().postDataJSON())
      if (url.pathname === '/api/tasks/limit') {
        if (refuse) return route.fulfill({ status: 400, json: { error: 'CLI refuses this value' } })
        await new Promise<void>(resolve => { release = resolve })
        resumed = true
        return route.fulfill({ json: { ok: true } })
      }
      return route.fulfill({ json: { settings: [], problems: [] } })
    })
    await page.goto('/#/board?machine=remote&task=demo%2F98')
    await page.locator('.task-needs').getByRole('button', { name: 'Raise limit', exact: true }).click()
    await expect(page.locator('#task-limit-value')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    const panel = page.locator('.board-panel .task-sheet')
    await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Take as is', exact: true })).toBeVisible()
    await expect(panel).toContainText('new allowance')
    await expect(panel).toContainText('provider quotas')
    await expect(panel).toContainText('No limit')
    await fs.mkdir('.shots', { recursive: true })
    await page.screenshot({ path: `.shots/work-${kind}-stopped-phone.png` })
    await panel.getByRole('button', { name: 'Raise limit', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(commands).toEqual([])
    await panel.getByRole('button', { name: 'Raise limit', exact: true }).click()
    await expect(page.locator('#task-limit-kind')).toContainText(kind === 'time' ? 'time per run' : 'tokens for the whole task')
    await expect(page.locator('#task-limit-kind select')).toHaveCount(0)
    await expect(page.locator('#task-limit-value')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Apply limit' })).toBeDisabled()
    const value = kind === 'time' ? '4h' : '3m'
    await page.locator('#task-limit-value').fill(value)
    await fs.mkdir('.shots', { recursive: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.shots/work-${kind}-raise-phone.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.shots/work-${kind}-raise-desktop.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Apply limit' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'CLI refuses this value' }).first()).toBeVisible()
    refuse = false
    await page.getByRole('button', { name: 'Apply limit' }).click()
    await expect(page.getByRole('button', { name: 'Resuming…' })).toBeVisible()
    release!()
    await expect(panel.getByRole('button', { name: 'Raise limit', exact: true })).toHaveCount(0)
    expect(reads).toBeGreaterThan(1)
    expect(commands).toEqual(Array(2).fill({ machine: 'remote', id: 'demo/98', name: `limit.${kind}`, value }))
  })
}

test('work limits remain readable without a configured ceiling', async ({ page }) => {
  const row = { id: 'demo/98', repo: 'demo', n: 98, stage: 'working', state: 'working', group: 'working', title: 'Garden', app: 'codex' }
  await page.route('**/api/tasks**', route => {
    const details = new URL(route.request().url()).pathname === '/api/tasks/details'
    return route.fulfill({ json: details ? { ...row, limits: { time: 'none', timeUsed: '0s', tokens: 'none', tokensUsed: null } } : { machines: [{ machine: 'remote', status: 'ready', tasks: [row] }] } })
  })
  await page.goto('/#/board?machine=remote&task=demo%2F98')
  await page.locator('.board-panel-tabs').getByRole('button', { name: 'Task', exact: true }).click()
  const panel = page.locator('.board-panel')
  await expect(panel).toContainText('No limit')
  await expect(panel.getByRole('button', { name: 'Raise limit', exact: true })).toHaveCount(0)
  await fs.mkdir('.shots', { recursive: true })
  await page.screenshot({ path: '.shots/work-limit-phone.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '.shots/work-limit-desktop.png' })
})

test('a provider quota wait never offers raising a work ceiling', async ({ page }) => {
  const row = { id: 'demo/98', repo: 'demo', n: 98, stage: 'asks', state: 'blocked', kind: 'question', group: 'needs', title: 'Garden', msg: 'Provider quota reached', app: 'codex' }
  await page.route('**/api/tasks**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/tasks/details' ? row : { machines: [{ machine: 'remote', status: 'ready', tasks: [row] }] } }))
  await page.goto('/#/board?machine=remote&task=demo%2F98')
  await expect(page.locator('.board-panel')).toContainText('Provider quota reached')
  await expect(page.getByRole('button', { name: 'Raise limit', exact: true })).toHaveCount(0)
})

for (const stopped of ['tokens', undefined]) {
  test(`a ${stopped || 'missing'} stop never silently promises resumption`, async ({ page }) => {
    const row = { id: 'demo/98', repo: 'demo', n: 98, stage: 'stopped', state: 'blocked', group: 'needs', title: 'Garden', app: 'codex' }
    const posts: unknown[] = []
    let saved = false
    await page.route('**/api/tasks**', route => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON())
        saved = true
        return route.fulfill({ json: { ok: true } })
      }
      return route.fulfill({ json: url.pathname === '/api/tasks/details'
        ? { ...row, limits: { time: '4h', timeUsed: '', tokens: saved ? '3m' : '2m', tokensUsed: 2000000, stopped } }
        : { machines: [{ machine: 'remote', status: 'ready', tasks: [row] }] } })
    })
    await page.goto('/#/board?machine=remote&task=demo%2F98')
    await page.locator('.task-needs').getByRole('button', { name: 'Raise limit', exact: true }).click()
    const apply = page.getByRole('button', { name: 'Apply limit', exact: true })
    if (!stopped) {
      await expect(page.locator('#task-limit-kind')).toContainText('not available')
      await expect(apply).toBeDisabled()
      expect(posts).toEqual([])
      return
    }
    await expect(page.locator('#task-limit-kind')).toContainText('tokens for the whole task')
    await expect(page.locator('#task-limit-kind select')).toHaveCount(0)
    await page.locator('#task-limit-value').fill('3m')
    await apply.click()
    await expect(page.getByRole('status').filter({ hasText: 'Resumption is not confirmed yet' })).toBeVisible()
    await expect(apply).toBeVisible()
    await fs.mkdir('.shots', { recursive: true })
    await page.screenshot({ path: '.shots/work-tokens-still-stopped-phone.png' })
    expect(posts).toEqual([{ machine: 'remote', id: 'demo/98', name: 'limit.tokens', value: '3m' }])
  })
}

test('a duration entered after a token stop never changes the time ceiling or closes the sheet', async ({ page }) => {
  const row = { id: 'demo/98', repo: 'demo', n: 98, stage: 'stopped', state: 'blocked', group: 'needs', title: 'Garden', app: 'codex' }
  const posts: Record<string, unknown>[] = []
  let time = '2h'
  await page.route('**/api/tasks**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/tasks/limit') {
      const body = route.request().postDataJSON()
      posts.push(body)
      // Reproduce the review failure if the UI ever picks the unrelated ceiling again:
      // the CLI accepts that time setting, but the task stays stopped for tokens.
      if (body.name === 'limit.time') {
        time = body.value
        return route.fulfill({ json: { ok: true } })
      }
      return route.fulfill({ status: 400, json: { error: 'Token limit needs a token count' } })
    }
    return route.fulfill({ json: url.pathname === '/api/tasks/details'
      ? { ...row, limits: { time, timeUsed: '', tokens: '2m', tokensUsed: 2000000, stopped: 'tokens' } }
      : { machines: [{ machine: 'remote', status: 'ready', tasks: [row] }] } })
  })
  await page.goto('/#/board?machine=remote&task=demo%2F98')
  await page.locator('.task-needs').getByRole('button', { name: 'Raise limit', exact: true }).click()
  await expect(page.locator('#task-limit-kind')).toContainText('tokens for the whole task')
  await page.locator('#task-limit-value').fill('4h')
  await page.getByRole('button', { name: 'Apply limit', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Token limit needs a token count' }).first()).toBeVisible()
  await expect(page.locator('#task-limit-value')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply limit', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resuming…', exact: true })).toHaveCount(0)
  expect(time).toBe('2h')
  expect(posts).toEqual([{ machine: 'remote', id: 'demo/98', name: 'limit.tokens', value: '4h' }])
})
