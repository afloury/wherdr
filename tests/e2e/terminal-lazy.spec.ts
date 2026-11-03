import { expect, test } from './test'
import { OMP_CHAT_PANE, fakeHerdr } from './scenario.mjs'

// xterm.js (and its WebGL add-on) are downloaded only when a terminal is shown
// (app/utils/xtermLoader.ts): a conversation read in chat mode never fetches them.
// The chunks have hashed names: they are told apart by a string of their own.
const XTERM = 'xterm-helper-textarea'
const WEBGL = 'preserveDrawingBuffer'
const paneAttached = async () => ((await fakeHerdr('e2e.pane_size', { pane_id: OMP_CHAT_PANE })) as { attached: boolean }).attached

test('a conversation in chat mode loads no terminal code until the terminal is shown', async ({ page }) => {
  const scripts: string[] = []
  page.on('response', async (res) => {
    if (!/\/_nuxt\/.*\.js$/.test(res.url())) return
    scripts.push(await res.text().catch(() => ''))
  })
  const loaded = (marker: string) => scripts.some(s => s.includes(marker))
  await page.addInitScript(() => localStorage.setItem('terminalRenderer', 'webgl'))
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(loaded(XTERM)).toBe(false)
  expect(loaded(WEBGL)).toBe(false)

  const tabs = page.locator('.view-toggle')
  if (await tabs.count()) await page.getByRole('button', { name: 'Show terminal', exact: true }).click()
  else await page.locator('button[aria-label="Terminal"]').first().click()
  await expect(page.locator('#term .xterm')).toBeVisible()
  // The terminal attaches and fits this screen, as before.
  await expect.poll(paneAttached).toBe(true)
  await expect.poll(() => loaded(XTERM)).toBe(true)
  await expect.poll(() => loaded(WEBGL)).toBe(true)
})
