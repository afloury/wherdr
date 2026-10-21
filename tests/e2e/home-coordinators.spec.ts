import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import { CLAUDE_PANE, COORDINATOR_PANE, OMP_CHAT_PANE } from './scenario.mjs'

// The home list's Coordinators section: the board's Coordinator and the
// machine coordinator each have their own icon and label, unlike a repo's
// project coordinator (the wherdr mark and "Coordinator"). Neutral links only.
for (const language of ['en', 'fr']) {
  test(`home coordinators: one icon and label per kind, ${language}`, async ({ page }, info) => {
    await page.addInitScript(lang => localStorage.setItem('herdrLanguage', lang), language)
    await page.route('**/api/tasks/links**', route => route.fulfill({ json: {
      version: 'coordinators-fixture', machines: [{ machine: '', tasks: [], coordinators: [
        { level: 'top', pane: COORDINATOR_PANE, workspace: null },
        { level: 'machine', pane: CLAUDE_PANE, workspace: null },
        { level: 'project', repo: 'demo', pane: OMP_CHAT_PANE, workspace: null },
      ] }],
    } }))
    await page.goto('/')
    const section = page.locator('.agent-group.coordinators')
    const top = section.locator(`.card[data-pane="${COORDINATOR_PANE}"]`)
    const machine = section.locator(`.card[data-pane="${CLAUDE_PANE}"]`)
    await expect(top.locator('.card-title')).toHaveText(language === 'fr' ? 'Coordinateur du board' : 'Board coordinator')
    await expect(machine.locator('.card-title')).toHaveText(language === 'fr' ? 'Coordinateur de la machine' : 'Machine coordinator')
    // Labels read in uppercase mono, as before.
    await expect(top.locator('.card-title')).toHaveCSS('text-transform', 'uppercase')
    // Each its own icon: the board's, the machine's (local: a server).
    await expect(top.locator('.avatar.coord .iconify')).toHaveClass(/square-kanban/)
    await expect(machine.locator('.avatar.coord .iconify')).toHaveClass(/server/)
    await expect(top.locator('.card-title')).toHaveAttribute('title', /.+/)
    // The project coordinator keeps its head row in its repo group.
    const lead = page.locator('.card.home-lead', { hasText: 'demo' })
    await expect(lead.locator('.lead-mark.coord')).toBeVisible()
    await expect(lead.locator('.lead-coord-tag')).toHaveText(language === 'fr' ? 'Coordinateur' : 'Coordinator')
    for (const card of [top, machine]) expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await fs.mkdir('.shots', { recursive: true })
    await page.screenshot({ path: `.shots/home-coordinators-${language}-${info.project.name}.png` })
  })
}
