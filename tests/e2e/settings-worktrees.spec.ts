import { expect, test } from './test'

for (const width of [390, 1440]) for (const theme of ['catppuccin-latte', 'wherdr-graphite']) {
  test(`Settings worktrees group machines and projects at ${width} in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme)
    await page.route('**/api/worktrees', route => route.fulfill({ json: [
      { machine: '', repo: 'Demo', repoRoot: '/repos/demo', path: '/worktrees/feature-one', branch: 'feature-one', agents: 2, panes: 2, workspace: 'demo', prunable: false },
      { machine: '', repo: 'Demo', repoRoot: '/repos/demo', path: '/worktrees/feature-two', branch: 'feature-two', agents: 0, panes: 0, workspace: null, prunable: false },
      { machine: '', repo: 'Tools', repoRoot: '/repos/tools', path: '/worktrees/tools', branch: 'tools', agents: 0, panes: 0, workspace: null, prunable: true },
      { machine: 'build-server-with-a-long-machine-label', repo: 'Demo', repoRoot: '/repos/demo', path: '/worktrees/remote', branch: 'remote-feature', agents: 0, panes: 0, workspace: null, prunable: false },
    ] }))
    await page.goto('/#/settings?section=agents')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const card = page.locator('.wt-card')
    await expect(card.locator('.wt-list li')).toHaveCount(3)
    const project = card.locator('.wt-project-heading').first()
    await expect(project).toContainText('Demo')
    await expect(project.locator('.wt-count')).toHaveText('2')
    await project.click()
    await expect(project).toHaveAttribute('aria-expanded', 'false')
    await expect(card.getByText('feature-one', { exact: true })).toBeHidden()
    await project.click()
    await expect(card.getByText('feature-one', { exact: true })).toBeVisible()
    await card.getByRole('tab', { name: 'build-server-with-a-long-machine-label' }).click()
    await expect(card.locator('.wt-list li')).toHaveCount(1)
    await expect(card.getByText('remote-feature', { exact: true })).toBeVisible()
    await card.getByRole('tab').first().click()
    await card.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.shots/settings-worktrees-${width}-${theme}.png` })
  })
}
