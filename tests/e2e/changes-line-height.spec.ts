import { expect, test, type Page } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'

// One diff line is one line on screen: the comment gutter must not stretch a
// row, and its line number stays on the row's single line of text.
const body = (sign: string, n: number) => Array.from({ length: n }, (_, i) => ({ kind: sign === '+' ? 'add' : 'del', text: `${sign}const v${i + 1} = ${i + 1}` }))
const files = [
  { path: 'src/added.ts', status: '??', added: 154, deleted: 0, binary: false, truncated: false, lines: [{ kind: 'hunk', text: '@@ -0,0 +1,154 @@' }, ...body('+', 154)] },
  { path: 'src/modified.ts', status: ' M', added: 1, deleted: 1, binary: false, truncated: false, lines: [
    { kind: 'meta', text: 'diff --git a/src/modified.ts b/src/modified.ts' }, { kind: 'hunk', text: '@@ -12345,3 +12345,3 @@' },
    { kind: 'context', text: ' function total() {' }, { kind: 'del', text: '-  return 1' }, { kind: 'add', text: '+  return 2' }, { kind: 'context', text: ' }' },
  ] },
  { path: 'src/deleted.ts', status: ' D', added: 0, deleted: 12, binary: false, truncated: false, lines: [{ kind: 'hunk', text: '@@ -1,12 +0,0 @@' }, ...body('-', 12)] },
]
const data = { git: true, root: '/project', branch: 'review-example', working: { count: files.length, truncated: false, files } }

async function openChanges(page: Page) {
  await page.route('**/api/changes?**', r => r.fulfill({ json: data }))
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'View changes', exact: true }).or(page.getByRole('button', { name: 'View changes', exact: true })).click()
  await expect(page.locator('.changes-view')).toBeVisible()
}

for (const f of files) {
  test(`${f.path}: every diff line is one line high, number in the gutter on that line`, async ({ page }, info) => {
    await openChanges(page)
    const file = page.locator('.change-file').filter({ hasText: f.path })
    await file.locator('summary').click()
    await expect(file.locator('.change-line')).toHaveCount(f.lines.length)
    const rows = await file.locator('.change-line').evaluateAll(els => els.map((el) => {
      const row = el.getBoundingClientRect()
      const gutter = el.querySelector('.review-gutter')?.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(el.querySelector('.review-source')!)
      const text = range.getBoundingClientRect()
      return {
        top: row.top, height: row.height, line: Number.parseFloat(getComputedStyle(el).lineHeight),
        textTop: text.top, textHeight: text.height,
        gutter: gutter ? { top: gutter.top, height: gutter.height } : null,
        // Vertical extent of everything written in the gutter (number and marker).
        marks: [...(el.querySelector('.review-gutter')?.childNodes ?? [])].map((n) => {
          const r = document.createRange()
          r.selectNodeContents(n)
          const b = r.getBoundingClientRect()
          return { top: b.top, bottom: b.bottom }
        }),
      }
    }))
    for (const [i, r] of rows.entries()) {
      // One line of text plus at most 4 px of padding: no blank line after it.
      expect(r.height, `row ${i}`).toBeLessThanOrEqual(r.line + 4)
      expect(r.textHeight, `text ${i}`).toBeLessThanOrEqual(r.line + 1)
      if (i) expect(r.top - rows[i - 1]!.top, `step ${i}`).toBeCloseTo(rows[i - 1]!.height, 0)
      if (!r.gutter) continue
      expect(r.gutter.height, `gutter ${i}`).toBeCloseTo(r.height, 0)
      for (const m of r.marks) {
        expect(m.top, `gutter mark ${i}`).toBeGreaterThanOrEqual(r.top - 1)
        expect(m.bottom, `gutter mark ${i}`).toBeLessThanOrEqual(r.top + r.height + 1)
      }
    }
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-diff-${f.path.split('/').pop()!.replace('.ts', '')}.png` })
  })
}
