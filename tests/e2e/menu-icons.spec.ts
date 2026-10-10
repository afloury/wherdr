import { expect, test, type Page } from '@playwright/test'
import { CLAUDE_PANE } from './scenario.mjs'

const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

// Icons are bundled at build time; one named only in a .ts file used to be
// left out ("failed to load icon"), leaving the menu entry without its icon.
test('the herdr-projects entries of an agent menu have their icons', async ({ page }, testInfo) => {
  const action = (id: string) => ({
    plugin: 'herdr-projects', pluginName: 'Herdr Projects', id, title: id, label: id, description: null,
    agent: true, machine: true, confirm: false, inHerdr: false,
  })
  await page.route('**/api/plugins/actions*', route => route.fulfill({ json: { actions: ['new', 'doctor'].map(action) } }))
  const iconErrors: string[] = []
  page.on('console', (m) => { if (/failed to load icon/i.test(m.text())) iconErrors.push(m.text()) })

  await page.goto(`/#/a/${CLAUDE_PANE}`)
  await expect(page.locator('.chat').getByText('All steps noted.')).toBeVisible()
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()

  // A dropdown on a computer, a sheet on a phone.
  const name = 'Check herdr-projects setup'
  const entry = page.getByRole('menuitem', { name }).or(page.getByRole('button', { name }))
  await entry.scrollIntoViewIfNeeded()
  await expect(entry).toBeVisible()
  const icon = entry.locator('.iconify, svg').first()
  await expect(icon).toBeVisible()
  const box = (await icon.boundingBox())!
  expect(box.width).toBeGreaterThan(8)
  expect(box.height).toBeGreaterThan(8)
  await page.waitForTimeout(300) // end of the menu animation, for the screenshot
  await shot(page, 'projects-menu-icons', testInfo.project.name)
  expect(iconErrors).toEqual([])
})
