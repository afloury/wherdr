import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './test'
import { OMP_IMAGE_PANE, REVIEW_CSV, REVIEW_CSV_TEXT } from './scenario.mjs'

// A file path in a reply: Preview shows the file, Download saves it, both read
// on the agent's machine (useful when that machine is not this computer).
// The menu is a dropdown on a computer and a bottom sheet on the phone.
const action = (page: Page, name: string) =>
  page.getByRole('menuitem', { name, exact: true }).or(page.locator('.hw-sheet').getByRole('button', { name, exact: true }))

test('a file named in a reply opens in a preview and downloads intact', async ({ page }, info) => {
  await page.goto(`/#/a/${OMP_IMAGE_PANE}`)
  const link = page.locator('.chat .md-path', { hasText: REVIEW_CSV })
  await expect(link).toBeVisible()

  await link.click()
  if (process.env.SHOTS) await action(page, 'Preview').waitFor().then(() => page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-file-link-menu.png` }))
  await action(page, 'Preview').click()
  const sheet = page.locator('.hw-sheet').filter({ has: page.locator('.files-view') })
  await expect(sheet.locator('.files-text')).toContainText('login,clipped button')
  await expect(sheet.locator('.files-crumb.current')).toHaveText('login-review.csv')
  await expect(sheet.locator('.changes-location')).toContainText(`/projects/screens/${REVIEW_CSV}`)
  if (process.env.SHOTS) {
    await page.waitForTimeout(400) // opening animation
    await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-file-link-preview.png` })
  }

  const fromPreview = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Download', exact: true }).click()
  const saved = await fromPreview
  expect(saved.suggestedFilename()).toBe('login-review.csv')
  expect(readFileSync(await saved.path(), 'utf8')).toBe(REVIEW_CSV_TEXT)

  await sheet.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(sheet).toHaveCount(0)

  await link.click()
  const fromMenu = page.waitForEvent('download')
  await action(page, 'Download').click()
  const direct = await fromMenu
  expect(direct.suggestedFilename()).toBe('login-review.csv')
  expect(readFileSync(await direct.path(), 'utf8')).toBe(REVIEW_CSV_TEXT)
})
