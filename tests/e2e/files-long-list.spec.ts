import { expect, test } from '@playwright/test'
import { OMP_CHAT_PANE } from './scenario.mjs'

// A folder of 1500 files: the list scrolls in the Files window and its last
// file can be reached and opened.
const COUNT = 1500
const name = (i: number) => `note-${String(i).padStart(4, '0')}.md`
const listing = { root: '/project/inbox', path: 'done', truncated: false, entries: Array.from({ length: COUNT }, (_, i) => ({ name: name(i + 1), kind: 'file', size: 120 + i, link: false })) }

test('the last file of a 1500-file folder is reached by scrolling and opens', async ({ page, isMobile }, info) => {
  test.slow() // 1500 rows: WebKit needs several seconds to lay them out on a small machine
  await page.route('**/api/files?**', r => r.fulfill({ json: listing }))
  await page.route('**/api/files/read?**', r => r.fulfill({ json: { path: `done/${name(COUNT)}`, size: 14, kind: 'text', text: 'last file\n', truncated: false } }))
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()
  const started = Date.now()
  await page.getByRole('menuitem', { name: 'Browse files', exact: true }).or(page.getByRole('button', { name: 'Browse files', exact: true })).click()
  const entries = page.locator('.files-entry')
  await expect(entries).toHaveCount(COUNT)
  info.annotations.push({ type: 'open-ms', description: String(Date.now() - started) })

  const first = entries.first()
  const last = entries.last()
  await expect(first).toBeInViewport()
  await expect(last).not.toBeInViewport()
  // The scroll container nearest to the list is the one that scrolls: a
  // wrapper with `overflow: auto` and nothing to scroll would keep the wheel
  // or the finger for itself.
  const scroller = await first.evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return { name: p.className, room: p.scrollHeight - p.clientHeight }
    }
    return null
  })
  expect(scroller?.room, `scroll container: ${scroller?.name}`).toBeGreaterThan(1000)

  if (isMobile) await last.scrollIntoViewIfNeeded()
  else {
    const box = (await first.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    // Mouse wheel, as a user would: a few large steps to the end of the list.
    await expect(async () => {
      await page.mouse.wheel(0, 20_000)
      await expect(last).toBeInViewport({ timeout: 500 })
    }).toPass({ timeout: 15_000 })
    await expect(first).not.toBeInViewport()
  }
  await expect(last).toBeInViewport()
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-files-1500-end.png` })
  await last.click()
  // A .md note opens formatted (Rendered is the default).
  await expect(page.locator('.files-md')).toHaveText('last file')
  await expect(page.locator('.files-crumb.current')).toHaveText(name(COUNT))
})
