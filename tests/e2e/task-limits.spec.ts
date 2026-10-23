// Task limits (herdr-projects 1.2.16+): the Task tab's gauges, and a task
// stopped at a limit — Continue, Raise the limit, Take it as it is. The
// plugin's launcher is a fake that answers with `details --json` as 1.2.21
// writes it (limits/shown.rs) and writes down each call.
import { expect, test } from './test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fakeHerdr } from './scenario.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-limits-'))
const calls = path.join(root, 'calls.log')
const keyReply = JSON.stringify({ settings: [{ name: 'repo.key', kind: 'repo', value: 'DEMO', from: 'your entry', place: 'you', own: false, note: '' }], problems: [] })
fs.mkdirSync(path.join(root, 'bin'))
// `set`: refused when the spec says so; else the board carries on by itself
// (after-set.json becomes the list, as its next tick would).
fs.writeFileSync(path.join(root, 'bin/run.sh'), `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
case "$1" in
  list) if [ "$3" = --archived ]; then echo '[]'; else cat '${root}/list.json'; fi ;;
  details) cat '${root}/details.json' ;;
  version) echo 'herdr-projects 1.2.21 (/opt/herdr-projects/bin/herdr-projects-linux-x86_64)' ;;
  set) if [ -f '${root}/refuse' ]; then cat '${root}/refuse' >&2; exit 1; fi
    if [ -f '${root}/after-set.json' ]; then mv '${root}/after-set.json' '${root}/list.json'; fi; echo "set" ;;
  retry|finish) echo "$3: done" ;;
  show) echo '${keyReply}' ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`, { mode: 0o755 })
const manifest = { plugin_id: 'herdr-projects', enabled: true, version: '1.2.21', plugin_root: root, startup: [{ command: ['sh', 'bin/run.sh', 'hook'] }], actions: [{ id: 'open', command: ['sh', 'bin/run.sh', 'open'] }] }
const callLog = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [])
const write = (name: string, v: unknown) => fs.writeFileSync(path.join(root, name), JSON.stringify(v))

const title = 'Tidy the search page'
const working = { id: 'demo/9', title, stage: 'working', state: 'working', app: 'claude', msg: 'Running the tests' }
const stopped = { ...working, stage: 'stopped', state: 'blocked', msg: 'stopped at its 2h limit' }
const limits = (extra: Record<string, unknown> = {}) => ({
  time: { limit: '2h' }, tokens: { limit: '30m', used: 3_400_000, total: 3_400_000 }, ...extra,
})

test.beforeEach(async () => {
  for (const f of ['refuse', 'after-set.json', 'calls.log']) fs.rmSync(path.join(root, f), { force: true })
  await fakeHerdr('e2e.plugins', { plugins: [manifest] })
})
test.afterEach(async () => { await fakeHerdr('e2e.plugins', { plugins: [] }) })
test.afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

const shot = async (page: import('@playwright/test').Page, name: string) => {
  await page.screenshot({ path: `.shots/limits-${name}-phone.png` })
  const phone = page.viewportSize()!
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: `.shots/limits-${name}-desktop.png` })
  await page.setViewportSize(phone)
}

for (const lang of ['en', 'fr']) {
  test(`the Task tab shows a gauge per limit (${lang})`, async ({ page }) => {
    await page.addInitScript(l => localStorage.setItem('herdrLanguage', l), lang)
    write('list.json', [working])
    write('details.json', { task: { ...working, description: 'Make the search page easier to scan.' }, limits: limits({ time: { limit: '2h', used: '2m38s', usedMs: 158_000 } }) })
    await page.goto('/#/board?machine=&task=demo%2F9')
    const panel = page.locator('.board-panel')
    await panel.locator('.board-panel-tabs').getByRole('button', { name: lang === 'fr' ? 'Tâche' : 'Task', exact: true }).click()
    await expect(panel.locator('.task-limit')).toHaveCount(2, { timeout: 20_000 })
    await shot(page, `gauges-${lang}`)
    await expect(panel.locator('.task-limit[data-kind="time"] .task-limit-label')).toHaveText(lang === 'fr' ? 'Temps' : 'Time')
    await expect(panel.locator('.task-limit[data-kind="time"] .task-limit-value')).toHaveText('2 min 38 / 2 h')
    await expect(panel.locator('.task-limit[data-kind="tokens"] .task-limit-value')).toHaveText(lang === 'fr' ? '3,4 M / 30 M' : '3.4 M / 30 M')
    await expect(panel.locator('.task-limit.hot')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test(`a task stopped at its limit: raise it with one tap (${lang})`, async ({ page }) => {
    await page.addInitScript(l => localStorage.setItem('herdrLanguage', l), lang)
    write('list.json', [stopped])
    write('details.json', { task: { ...stopped, description: 'Make the search page easier to scan.' }, limits: limits({ stopped: { what: 'time', limit: '2h', used: 7_200_000, role: 'worker', line: stopped.msg } }) })
    write('after-set.json', [working])
    await page.goto('/#/board?machine=&task=demo%2F9')
    const banner = page.locator('.task-needs')
    // The previous test's list is reused for a few seconds (REUSE_MS).
    await expect(banner).toContainText('stopped at its 2h limit', { timeout: 20_000 })
    await shot(page, `stopped-${lang}`)
    await expect(banner.locator('.task-needs-actions button').nth(0)).toHaveText(lang === 'fr' ? 'Continuer' : 'Continue')
    await expect(banner.locator('.task-needs-actions button').nth(1)).toHaveText(lang === 'fr' ? 'Relever la limite' : 'Raise the limit')
    await expect(banner.locator('.task-needs-actions button').nth(2)).toHaveText(lang === 'fr' ? 'Prendre telle quelle' : 'Take it as it is')
    await expect(banner.locator('.task-limit-why')).toContainText(lang === 'fr' ? 'la même limite une fois de plus (2 h par passage)' : 'the same limit once more (2 h a run)')
    await banner.locator('.task-limit-raise').click()
    const sheet = page.locator('.raise-limit')
    await expect(sheet.locator('.raise-limit-value')).toHaveText('2 h / 2 h')
    await expect(sheet.locator('.raise-limit-preset')).toHaveText(['+1 h3 h', '×24 h', lang === 'fr' ? 'Sans limite' : 'No limit'])
    await shot(page, `raise-${lang}`)
    await sheet.locator('.raise-limit-preset').first().click()
    await expect(sheet).toHaveCount(0)
    await expect(banner.locator('.task-needs-resuming')).toHaveText(lang === 'fr' ? 'Reprise…' : 'Resuming…')
    // Only set: herdr-projects carries on by itself, so no retry follows.
    expect(callLog()).toContain('set --task=demo/9 -- limit.time 3h')
    expect(callLog().some(c => c.startsWith('retry'))).toBe(false)
    // Resuming… until the task list brings the task back at work.
    await expect(banner).toHaveCount(0, { timeout: 15_000 })
    expect(callLog().some(c => c.startsWith('retry'))).toBe(false)
  })
}

test('a refused raise shows herdr-projects’ words as they are', async ({ page }) => {
  write('list.json', [{ ...stopped, msg: 'stopped at 30m tokens' }])
  write('details.json', { task: { ...stopped, msg: 'stopped at 30m tokens' }, limits: limits({ time: { limit: 'none' }, tokens: { limit: '30m', used: 31_000_000, total: 31_000_000 }, stopped: { what: 'tokens', limit: '30m', used: 31_000_000, role: 'worker' } }) })
  fs.writeFileSync(path.join(root, 'refuse'), 'demo/9 is busy. Try again in a moment.\n')
  await page.goto('/#/board?machine=&task=demo%2F9')
  await page.locator('.task-limit-raise').click({ timeout: 20_000 })
  const sheet = page.locator('.raise-limit')
  await expect(sheet.locator('.raise-limit-preset')).toHaveText(['×260 M', '+10 M40 M', 'No limit'])
  await sheet.locator('.raise-limit-preset').nth(1).click()
  await expect(sheet.locator('.error')).toHaveText('demo/9 is busy. Try again in a moment.')
  expect(callLog()).toContain('set --task=demo/9 -- limit.tokens 40m')
  await expect(page.locator('.task-needs-resuming')).toHaveCount(0)
})
