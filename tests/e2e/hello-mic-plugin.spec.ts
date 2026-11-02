import { expect, test } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'
import { cp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// The example plugin (examples/plugins/hello-mic) installed like a user would:
// copied into DATA_DIR/plugins/hello-mic, then the page is reloaded.
const plugins = join(resolve(process.env.E2E_TMP_DIR || '.e2e-tmp'), 'data/plugins')
const dest = join(plugins, 'hello-mic')

test.afterEach(async () => { await rm(plugins, { recursive: true, force: true }) })

test('hello-mic adds a mic button next to Send that inserts text; removing it restores the app', async ({ page }, testInfo) => {
  await cp(join('examples/plugins/hello-mic'), dest, { recursive: true, filter: s => !s.includes('/src') && !s.endsWith('README.md') })
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const mic = page.locator('[data-wherdr="composer-actions"] .hello-mic')
  await expect(mic).toBeVisible()
  const field = page.locator('.prompt textarea')
  await field.fill('Before.')
  await mic.click()
  await expect(field).toHaveValue(/Before\.\s*This is a sample dictated text\./)
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${testInfo.project.name}-hello-mic.png` })

  await rm(plugins, { recursive: true, force: true })
  await page.reload()
  await expect(page.locator('.prompt textarea')).toBeVisible()
  await expect(page.locator('.hello-mic')).toHaveCount(0)
})

test('a broken copy of hello-mic is disabled, the composer stays usable', async ({ page }) => {
  await cp(join('examples/plugins/hello-mic'), dest, { recursive: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(dest, 'index.js'), 'export default () => { throw new Error("broken on purpose") }')
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const field = page.locator('.prompt textarea')
  await field.fill('still works')
  await expect(field).toHaveValue('still works')
  await expect(page.locator('.hello-mic')).toHaveCount(0)
})
