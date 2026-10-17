import { expect, test } from '@playwright/test'
import { fakeHerdr } from './scenario.mjs'

// Settings › Plugins › herdr-projects with a herdr-projects wherdr cannot read
// (1.x), or a 0.2 from upstream whose own update would install 1.x.
const v1 = {
  plugin_id: 'herdr-projects', enabled: true, version: '1.2.1', plugin_root: '/tmp/herdr-projects-1x',
  startup: [{ command: ['sh', 'bin/run.sh', 'hook'] }],
  actions: [{ id: 'open', command: ['sh', 'bin/run.sh', 'open'] }],
  source: { kind: 'github', owner: 'eliasstravik', repo: 'herdr-projects' },
}
// No commands: wherdr finds no binary, so other specs never try to run one.
const upstream02 = {
  plugin_id: 'herdr-projects', enabled: true, version: '0.2.34',
  source: { kind: 'github', owner: 'eliasstravik', repo: 'herdr-projects' },
}
const reinstall = 'herdr plugin uninstall herdr-projects && herdr plugin install afloury/herdr-projects --ref v0.2.36 --yes'

test.afterEach(async () => { await fakeHerdr('e2e.plugins', { plugins: [] }) })

test('says herdr-projects 1.x is not supported, with the way back to 0.2', async ({ page }, testInfo) => {
  await fakeHerdr('e2e.plugins', { plugins: [v1] })
  await page.goto('/#/settings?section=plugins')
  const machine = page.locator('.projects-plugin-machine').first()
  await expect(machine.locator('.projects-plugin-head .unsupported')).toHaveText('Not supported · v1.2.1', { timeout: 15000 })
  const note = machine.locator('.projects-plugin-unsupported')
  await expect(note).toContainText('herdr-projects 1.x is not supported by wherdr yet')
  await expect(note).toContainText('~/.herdr-projects-legacy')
  await expect(note.locator('.projects-plugin-command')).toHaveText(reinstall)
  await expect(note.getByRole('button', { name: 'Copy command' })).toBeVisible()
  await expect(note.getByRole('link', { name: 'Going back to 0.2' })).toHaveAttribute('href', /eliasstravik\/herdr-projects\/blob\/main\/docs\/old-installs\.md$/)
  // Installed: no install button, and the repository link points to the fork.
  await expect(machine.getByRole('button', { name: 'Install herdr-projects' })).toHaveCount(0)
  await expect(page.locator('.projects-plugin-link')).toHaveAttribute('href', 'https://github.com/afloury/herdr-projects')
  await note.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `.shots/projects-plugin-1x-${testInfo.project.name}.png` })
})

test('warns that a 0.2 installed from upstream would update itself to 1.x', async ({ page }, testInfo) => {
  await fakeHerdr('e2e.plugins', { plugins: [upstream02] })
  await page.goto('/#/settings?section=plugins')
  const machine = page.locator('.projects-plugin-machine').first()
  await expect(machine.locator('.projects-plugin-head .installed')).toHaveText('Installed · v0.2.34', { timeout: 15000 })
  const note = machine.locator('.projects-plugin-upstream')
  await expect(note).toContainText('Do not run “herdr-projects update” here')
  await expect(note.locator('.projects-plugin-command')).toHaveText(reinstall)
  await expect(machine.locator('.projects-plugin-unsupported')).toHaveCount(0)
  await note.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `.shots/projects-plugin-upstream-${testInfo.project.name}.png` })
})

test('a 0.2 from the fork shows no warning', async ({ page }) => {
  await fakeHerdr('e2e.plugins', { plugins: [{ ...upstream02, source: { kind: 'github', owner: 'afloury', repo: 'herdr-projects' } }] })
  await page.goto('/#/settings?section=plugins')
  const machine = page.locator('.projects-plugin-machine').first()
  await expect(machine.locator('.projects-plugin-head .installed')).toHaveText('Installed · v0.2.34', { timeout: 15000 })
  await expect(machine.locator('.plugin-input-note.warn')).toHaveCount(0)
})

test('installation confirmation identifies the prebuilt release without running the installer', async ({ page }, testInfo) => {
  await page.route('**/api/plugins/projects?*', route => route.fulfill({ json: {
    installed: false, enabled: false, version: null, unsupported: false, upstream: false, installable: true,
  } }))
  await page.goto('/#/settings?section=plugins')
  await page.getByRole('button', { name: 'Install herdr-projects', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('The v0.2.36 release provides a prebuilt binary.')
  await expect(dialog).not.toContainText('Rust')
  await page.screenshot({ path: `.shots/projects-plugin-install-${testInfo.project.name}.png` })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})
