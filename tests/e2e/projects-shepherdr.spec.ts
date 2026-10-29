import { expect, test } from './test'
import { fakeHerdr } from './scenario.mjs'
import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync(new URL('../fixtures/shepherdr-2.0.0.json', import.meta.url), 'utf8'))

test.afterEach(async () => { await fakeHerdr('e2e.plugins', { plugins: [] }) })

test('Shepherdr is unsupported and offers a manual pinned return', async ({ page }) => {
  await fakeHerdr('e2e.plugins', { plugins: [manifest] })
  await page.goto('/#/board')
  const note = page.locator('.projects-upgrade')
  await expect(note).toContainText('Shepherdr 2 detected: wherdr’s Board does not support it')
  await expect(note).toContainText('--ref v1.2.21 --yes')
  await expect(note.getByRole('button')).toHaveCount(1)
  await expect(note.getByRole('link')).toHaveAttribute('href', /#shepherdr-2$/)
  fs.mkdirSync('.shots', { recursive: true })
  await page.screenshot({ path: '.shots/shepherdr-phone.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '.shots/shepherdr-desktop.png', fullPage: true })
})
