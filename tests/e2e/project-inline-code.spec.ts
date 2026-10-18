import { expect, test, type Page } from '@playwright/test'
import { COORDINATOR_PANE } from './scenario.mjs'
import { parseTasks } from '../../shared/projectBoard'

// Project panel › Tasks: inline code in a task (`npm test`) looks as in a
// conversation; a tap opens its menu: Run… (the coordinator runs it in its
// shell mode, after a confirmation) and Copy.
const lists = parseTasks(`## To test
- [ ] Check the leak guard with \`npm run check:leaks\` [b:green(ready)] (me)
## Backlog
- [ ] Rename \`fooBar\` in \`app/utils/x.ts\` (agent)
`)

const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()
// Dropdown entry on a computer, sheet button on the phone.
const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name, exact: false }).or(page.locator('.hw-sheet').getByRole('button', { name, exact: false }))

// `theme`: an app theme id (the default, wherdr Titanium, is dark).
async function openPanel(page: Page, theme?: string) {
  await page.addInitScript(([pane, th]) => {
    localStorage.setItem('herdrLanguage', 'en')
    localStorage.setItem('viewModes', JSON.stringify({ [String(pane)]: 'project' }))
    if (th) localStorage.setItem('theme', String(th))
  }, [COORDINATOR_PANE, theme ?? ''] as const)
  await page.route('**/api/project?**', route => route.fulfill({ json: { slug: 'acme', version: 'v1', lists, open: [], resolved: [] } }))
  const sent: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/(prompt|input)$/.test(new URL(r.url()).pathname)) sent.push(String(r.postDataJSON()?.text ?? ''))
  })
  await page.goto(`/#/a/${COORDINATOR_PANE}`)
  await expect(page.locator('.project-panel .pp-task')).toHaveCount(2)
  return sent
}

test('inline code in a task is code, and its menu runs the command in the coordinator', async ({ page }, info) => {
  const sent = await openPanel(page)
  const code = page.locator('.project-panel code.pp-code', { hasText: 'npm run check:leaks' })
  await expect(code).toHaveAttribute('data-k', 'cmd')
  // Styled as in the chat: mono font, a 1 px rule on the left.
  const style = await code.evaluate(el => ({ font: getComputedStyle(el).fontFamily, rule: getComputedStyle(el).borderLeftWidth }))
  expect(style.font.toLowerCase()).toContain('mono')
  expect(style.rule).toBe('1px')
  await shot(page, 'task-code', info.project.name)

  await code.click()
  await expect(menuItem(page, 'Copy command')).toBeVisible()
  await shot(page, 'task-code-menu', info.project.name)
  await menuItem(page, 'Run…').click()
  const confirm = page.locator('.hw-sheet').filter({ has: page.locator('.confirm-code') })
  await expect(confirm.locator('.confirm-code')).toHaveText('npm run check:leaks')
  expect(sent).toEqual([])
  await confirm.getByRole('button', { name: 'Run', exact: true }).click()
  await expect.poll(() => sent).toEqual(['! npm run check:leaks'])
  expect(await page.locator('.project-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('code that is not a command can only be copied; light theme', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
  const sent = await openPanel(page, 'catppuccin-latte')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin-latte')
  const path = page.locator('.project-panel code.pp-code', { hasText: 'app/utils/x.ts' })
  await expect(path).toHaveAttribute('data-k', 'path')
  await shot(page, 'task-code-light', info.project.name)
  await page.locator('.project-panel code.pp-code', { hasText: 'fooBar' }).click()
  await expect(menuItem(page, 'Copy')).toBeVisible()
  await expect(menuItem(page, 'Run…')).toHaveCount(0)
  await menuItem(page, 'Copy').click()
  expect(sent).toEqual([])
})
