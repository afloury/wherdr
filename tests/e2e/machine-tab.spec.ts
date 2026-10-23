// A machine bar tab showing one machine: no machine header (the tab names
// it), its quotas together at the top (Claude, then Codex), and the machine's
// actions on a right click (computer) or long press (phone) of the tab. A
// group tab keeps the headers and offers its settings.
import { expect, test, type Page } from './test'
import fs from 'node:fs/promises'

const now = Date.now()
const win = (used: number, minutes: number) => ({ used, resetsAt: now + 3600000, minutes })
const account = (key: string, label: string, five: number, week: number) =>
  ({ five: win(five, 300), week: win(week, 10080), at: now, account: key.padEnd(16, 'a'), machines: [{ key, label }] })
// Codex shared by both machines (top of the list), a Claude account each.
const quotas = {
  claude: { five: win(4, 300), week: win(43, 10080), at: now },
  codex: { five: win(20, 300), week: win(35, 10080), at: now },
  claudeAccounts: [account('', 'Server', 4, 43), account('laptop', 'Laptop', 11, 7)],
}

async function setup(page: Page, laptop: 'online' | 'offline' = 'online') {
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).ok).toBe(true)
  const base = await (await page.request.get('/api/state')).json()
  const keys = ['', 'laptop']
  const machineFor = new Map(base.workspaces.map((w: { id: string }, i: number) => [w.id, keys[i % 2]]))
  const state = { ...base,
    machines: keys.map((key, i) => ({ key, label: ['Server', 'Laptop'][i], local: !key, status: key ? laptop : 'online', error: key && laptop === 'offline' ? 'SSH unavailable' : null, session: 'default' })),
    workspaces: base.workspaces.map((w: { id: string }) => ({ ...w, machine: machineFor.get(w.id) })),
    tabs: base.tabs?.map((t: { workspace: string }) => ({ ...t, machine: machineFor.get(t.workspace) })),
    panes: base.panes.map((p: { workspace: string }) => ({ ...p, machine: machineFor.get(p.workspace) })),
  }
  await page.routeWebSocket('**/ws/events', ws => ws.send(JSON.stringify(state)))
  await page.route('**/api/quotas', route => route.fulfill({ json: quotas }))
  await page.addInitScript(() => {
    if (localStorage.getItem('tabFixture')) return
    localStorage.setItem('tabFixture', '1')
    localStorage.setItem('machineGroups', JSON.stringify([{ id: '*group:perso', name: 'Perso', machines: ['laptop', ''] }]))
  })
  await page.goto('/')
  await expect(page.locator('.machine-bar-item', { hasText: 'Laptop' })).toBeVisible()
}
// Long press with a finger on the phone, right click on a computer.
async function openTabMenu(page: Page, label: string, phone: boolean) {
  const tab = page.locator('.machine-bar-item', { hasText: label })
  if (!phone) return tab.click({ button: 'right' })
  const box = (await tab.boundingBox())!
  await tab.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 10, clientY: box.y + 10 })
  await page.waitForTimeout(600)
  await tab.dispatchEvent('pointerup', { pointerType: 'touch' })
}
const menu = (page: Page, phone: boolean) => (phone ? page.getByRole('dialog') : page.getByRole('menu'))

test('a machine tab: no header, quotas together, actions on the tab', { tag: ['@chromium-desktop', '@webkit-phone'] }, async ({ page }, info) => {
  const phone = info.project.name.includes('phone')
  await setup(page)
  await page.evaluate(() => document.fonts.ready)
  await fs.mkdir('.shots', { recursive: true })
  await page.locator('.machine-bar-item', { hasText: 'Laptop' }).click()
  await expect(page.locator('section.machine')).toHaveCount(1)
  await page.screenshot({ path: `.shots/machine-tab-${info.project.name}.png` })

  await expect(page.locator('section.machine .machine-row')).toHaveCount(0)
  await expect(page.locator('section.machine .machine-quotas')).toHaveCount(0)
  const who = await page.locator('.scroll > .quotas .quota-who').evaluateAll(els => els.map(e => e.getAttribute('title')))
  expect(who.map(w => w?.split(' · ')[0])).toEqual(['Claude', 'Codex'])

  await openTabMenu(page, 'Laptop', phone)
  await expect(menu(page, phone)).toContainText('Herdr sessions')
  await expect(menu(page, phone)).toContainText('Open the board')
  await page.screenshot({ path: `.shots/machine-tab-menu-${info.project.name}.png` })
  await page.keyboard.press('Escape')
  await expect(menu(page, phone)).toHaveCount(0)

  // A group keeps the machine headers, and its menu opens its settings.
  await page.locator('.machine-bar-item', { hasText: 'Perso' }).click()
  await expect(page.locator('section.machine .machine-row')).toHaveCount(2)
  await openTabMenu(page, 'Perso', phone)
  await menu(page, phone).getByText('Group settings').click()
  await expect(page.locator('.machine-group-name input')).toHaveValue('Perso')
  await page.screenshot({ path: `.shots/machine-tab-group-settings-${info.project.name}.png` })
})

test('an offline machine tab says so at the top', async ({ page }, info) => {
  await setup(page, 'offline')
  await page.locator('.machine-bar-item', { hasText: 'Laptop' }).click()
  await expect(page.locator('.machine-tab-offline')).toContainText('Laptop is offline')
  await expect(page.locator('.machine-tab-offline')).toContainText('SSH unavailable')
  await expect(page.locator('.machine-bar-item.offline', { hasText: 'Laptop' })).toBeVisible()
  await page.screenshot({ path: `.shots/machine-tab-offline-${info.project.name}.png` })
})
