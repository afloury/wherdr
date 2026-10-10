import { expect, test, type Page } from '@playwright/test'
import { OMP_CHAT_PANE } from './scenario.mjs'

const file = (path: string, text: string) => ({ path, status: ' M', added: 1, deleted: 1, binary: false, truncated: false, lines: [
  { kind: 'hunk', text: '@@ -7 +10 @@' }, { kind: 'del', text: '-old' }, { kind: 'add', text },
] })
const data = { git: true, root: '/project', branch: 'review-example', working: { count: 2, truncated: false, files: [file('src/first.ts', '+first()'), file('src/second.ts', '+second()')] } }
async function openChanges(page: Page) {
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'View changes', exact: true }).or(page.getByRole('button', { name: 'View changes', exact: true })).click()
  await expect(page.locator('.changes-view')).toBeVisible()
}
async function setup(page: Page) {
  await page.route('**/api/changes?**', r => r.fulfill({ json: data }))
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
}
const field = (page: Page) => page.locator('.prompt').locator('textarea, [contenteditable="true"]').first()

test('two files review appends to the message draft without sending; survives closing and reload', async ({ page, isMobile }, info) => {
  await setup(page)
  const sent: string[] = []
  page.on('request', r => { if (r.method() === 'POST' && /\/api\/(prompt|input)$/.test(new URL(r.url()).pathname)) sent.push(r.url()) })
  await field(page).fill('Existing draft')
  await openChanges(page)
  for (const [path, body] of [['src/first.ts', 'Check the first call'], ['src/second.ts', 'Handle the empty case']]) {
    const f = page.locator('.change-file').filter({ hasText: path })
    await f.locator('summary').click()
    if (isMobile) await f.locator('.review-source').last().tap()
    else await f.locator('.review-source').last().click()
    await expect(f.locator('textarea')).toBeFocused()
    await f.locator('textarea').fill(body!)
  }
  await page.getByRole('button', { name: 'Refresh changes' }).click()
  await expect(page.locator('.review-note')).toHaveCount(2)
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-review-two-files.png` })
  await page.locator('.hw-sheet-close').click()
  await openChanges(page)
  await expect(page.locator('.review-note')).toHaveCount(2)
  await page.reload()
  await openChanges(page)
  await expect(page.locator('.review-note')).toHaveCount(2)
  await page.getByRole('button', { name: 'Send review', exact: true }).click()
  await expect(page.locator('.changes-view')).toHaveCount(0)
  const expected = 'Existing draft\n\nPlease review these points:\n\nsrc/first.ts:10 — Check the first call\n\nsrc/second.ts:10 — Handle the empty case'
  await expect(field(page)).toHaveValue(expected)
  expect(sent).toEqual([])
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-review-message-draft.png` })
  await openChanges(page)
  await expect(page.locator('.review-note')).toHaveCount(0)
})

test('deleted line, editing, disappeared line warning and discard', async ({ page }, info) => {
  await setup(page)
  await openChanges(page)
  const f = page.locator('.change-file').first()
  await f.locator('summary').click()
  await f.getByRole('button', { name: 'Comment on line 7 (old line)', exact: true }).click()
  await f.locator('textarea').fill('Keep this behaviour')
  await f.locator('textarea').fill('Keep the previous behaviour')
  await page.route('**/api/changes?**', r => r.fulfill({ json: { ...data, working: { ...data.working, count: 1, files: [file('src/second.ts', '+second()')] } } }))
  await page.getByRole('button', { name: 'Refresh changes' }).click()
  await expect(page.locator('.review-note.missing')).toContainText('Line no longer in the diff')
  await expect(page.locator('.review-note textarea')).toHaveValue('Keep the previous behaviour')
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-review-missing-line.png` })
  await page.getByRole('button', { name: 'Send review', exact: true }).click()
  await expect(field(page)).toHaveValue('Please review these points:\n\nsrc/first.ts:7 (old line, line no longer in diff) — Keep the previous behaviour')
  await openChanges(page)
  await page.locator('.change-file summary').click()
  await page.getByRole('button', { name: 'Comment on line 10', exact: true }).click()
  await page.locator('.review-note textarea').fill('Discard me')
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.locator('.review-note')).toHaveCount(0)
  expect(await page.evaluate(pane => localStorage.getItem(`review:${pane}`), OMP_CHAT_PANE)).toBeNull()
})

test('keyboard editing, delete, and text selection without creating a comment', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop keyboard and selection')
  await setup(page)
  await openChanges(page)
  const f = page.locator('.change-file').first()
  await f.locator('summary').click()
  await f.locator('.review-source').last().evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range) })
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('+first()')
  await f.locator('.review-source').last().dispatchEvent('click')
  await expect(page.locator('.review-note')).toHaveCount(0)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await f.locator('.review-source').last().dblclick()
  await page.waitForTimeout(300)
  await expect(page.locator('.review-note')).toHaveCount(0)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await f.getByRole('button', { name: 'Comment on line 10', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(f.locator('textarea')).toBeFocused()
  await f.locator('textarea').fill('Keyboard review')
  await f.getByRole('button', { name: 'Delete comment' }).click()
  await expect(page.locator('.review-note')).toHaveCount(0)
})

test('French review controls fit the phone and prepare a localized message', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('herdrLanguage', 'fr'))
  await setup(page)
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Voir les changements', exact: true }).or(page.getByRole('button', { name: 'Voir les changements', exact: true })).click()
  await page.locator('.change-file summary').first().click()
  await page.getByRole('button', { name: 'Commenter la ligne 10', exact: true }).first().click()
  await page.locator('.review-note textarea').fill('Vérifier la valeur vide')
  const send = page.getByRole('button', { name: 'Envoyer la relecture', exact: true })
  await expect(send).toBeVisible()
  const rect = (await send.boundingBox())!
  expect(rect.x).toBeGreaterThanOrEqual(0)
  expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-review-french.png` })
  await send.click()
  await expect(field(page)).toHaveValue('Merci de revoir ces points :\n\nsrc/first.ts:10 — Vérifier la valeur vide')
})
