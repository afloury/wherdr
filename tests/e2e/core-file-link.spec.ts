import fs from 'node:fs'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './fake-core'

// Port of file-link.spec.ts to herdr-core: a file path in a Claude Code reply. Preview and
// Download read the real file in the terminal's folder (the local core's disk).
const REVIEW_CSV = 'notes/login-review.csv'
const REVIEW_CSV_TEXT = 'screen,issue\r\nlogin,clipped button\r\n'
// The menu is a dropdown on a computer and a bottom sheet on the phone.
const action = (page: Page, name: string) =>
  page.getByRole('menuitem', { name, exact: true }).or(page.locator('.hw-sheet').getByRole('button', { name, exact: true }))

test('a file named in a reply opens in a preview and downloads intact', async ({ page, core }) => {
  const claude = core.claude('screens', [
    ['user', 'Check the login screenshot.'],
    ['assistant', `The login button is clipped.\n\nThe review is in \`${REVIEW_CSV}\`.`],
  ])
  const file = path.join(core.folder('screens'), REVIEW_CSV)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, REVIEW_CSV_TEXT)
  await page.goto(claude.url)
  const link = page.locator('.chat .md-path', { hasText: REVIEW_CSV })
  await expect(link).toBeVisible()

  await link.click()
  await action(page, 'Preview').click()
  const sheet = page.locator('.hw-sheet').filter({ has: page.locator('.files-view') })
  await expect(sheet.locator('.files-text')).toContainText('login,clipped button')
  await expect(sheet.locator('.files-crumb.current')).toHaveText('login-review.csv')
  await expect(sheet.locator('.changes-location')).toContainText(`/projects/screens/${REVIEW_CSV}`)

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
