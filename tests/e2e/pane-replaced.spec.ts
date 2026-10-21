import { expect, test, type Page } from '@playwright/test'
import { OMP_OLD_TABLE_PANE, fakeHerdr } from './scenario.mjs'
import { decisions, expectDraft } from './refs'

// Herdr closes an agent's pane and opens a new one for the same agent (the
// same conversation, as herdr-projects restarting a coordinator). The draft
// follows the agent, not the pane id (app/utils/agentIdentity.ts).
const NEW_PANE = OMP_OLD_TABLE_PANE.replace(/p1$/, 'p2')
const OLD = ['Drop the legacy importer?', 'Move the nightly job to 02:00 — after the backup?', 'Rename the public API field?']
const DRAFT = `${decisions('1-3', OLD.join(' · '))}\nOK to all\nBut wait for the backup first.`
const shot = (page: Page, name: string, project: string) =>
  process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png` }) : Promise.resolve()

// A quote and some words of one's own, not sent.
async function writeDraft(page: Page) {
  await page.addInitScript(() => localStorage.setItem('typewriterSpeed', 'off'))
  await page.goto(`/#/a/${OMP_OLD_TABLE_PANE}`)
  await expect(page.locator('.chat').getByText('Shall I delete the old staging database?').last()).toBeVisible()
  const field = page.locator('.prompt textarea').first()
  await field.fill('')
  await page.locator('.q-table .q-all').click()
  await expectDraft(field, `${DRAFT.split('\nBut')[0]}\n`)
  await field.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
  await field.pressSequentially('But wait for the backup first.')
  await expectDraft(field, DRAFT)
  return field
}

test.afterEach(async () => {
  // Back to the scenario's own pane, whatever the test left.
  await fakeHerdr('e2e.replace_pane', { pane_id: NEW_PANE, new_id: OMP_OLD_TABLE_PANE }).catch(() => {})
  await fakeHerdr('e2e.hide_pane', { pane_id: OMP_OLD_TABLE_PANE, hidden: false }).catch(() => {})
})

test('the open view moves to the new pane of the same agent, with its draft', async ({ page }, testInfo) => {
  await writeDraft(page)
  await fakeHerdr('e2e.replace_pane', { pane_id: OMP_OLD_TABLE_PANE, new_id: NEW_PANE })
  await expect(page).toHaveURL(new RegExp(`#/a/${encodeURIComponent(NEW_PANE)}$`))
  const field = page.locator('.prompt textarea').first()
  await expectDraft(field, DRAFT)
  await expect(page.locator('.term-banner')).toHaveCount(0)
  await shot(page, 'pane-replaced', testInfo.project.name)
  // The draft lives under the new pane now: it survives a reload there.
  await page.reload()
  await expectDraft(page.locator('.prompt textarea').first(), DRAFT)
})

test('a view reloaded on the closed pane still moves to its successor', async ({ page }) => {
  await writeDraft(page)
  await fakeHerdr('e2e.hide_pane', { pane_id: OMP_OLD_TABLE_PANE, hidden: true })
  await page.reload()
  await expect(page.locator('.term-banner.closed-banner')).toContainText('Your draft is kept below.')
  // The same agent comes back under a new id.
  await fakeHerdr('e2e.replace_pane', { pane_id: OMP_OLD_TABLE_PANE, new_id: NEW_PANE })
  await fakeHerdr('e2e.hide_pane', { pane_id: NEW_PANE, hidden: false })
  await expect(page).toHaveURL(new RegExp(`#/a/${encodeURIComponent(NEW_PANE)}$`))
  await expectDraft(page.locator('.prompt textarea').first(), DRAFT)
})

test('the new pane of the same agent picks up the closed pane’s draft when opened', async ({ page }) => {
  await writeDraft(page)
  await page.goto('/#/')
  await expect(page.locator('.prompt textarea')).toHaveCount(0)
  await fakeHerdr('e2e.replace_pane', { pane_id: OMP_OLD_TABLE_PANE, new_id: NEW_PANE })
  // Reopened from the list (the agent's card), as the user does.
  await page.goto(`/#/a/${NEW_PANE}`)
  await expectDraft(page.locator('.prompt textarea').first(), DRAFT)
})

test('a closed pane with no successor keeps its draft, with a way to copy it', async ({ page, context, browserName }, testInfo) => {
  const field = await writeDraft(page)
  // The agent left for good: its pane is gone and nothing took over.
  await fakeHerdr('e2e.hide_pane', { pane_id: OMP_OLD_TABLE_PANE, hidden: true })
  try {
    const banner = page.locator('.term-banner.closed-banner')
    await expect(banner).toContainText('This pane has been closed. Your draft is kept below.')
    await expectDraft(field, DRAFT)
    await shot(page, 'pane-closed-draft', testInfo.project.name)
    const copy = banner.getByRole('button', { name: 'Copy draft' })
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await copy.click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(await field.inputValue())
    } else {
      await expect(copy).toBeVisible()
    }
  } finally {
    await fakeHerdr('e2e.hide_pane', { pane_id: OMP_OLD_TABLE_PANE, hidden: false })
  }
})
