import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type FakeCore, type Page } from './fake-core'

// The file browser on herdr-core, reading real files in the terminal's folder through the
// server's file routes, in a real browser. Merged from files-markdown, files-long-list and
// file-link.spec.ts. Covered elsewhere and so not repeated: walking folders, dotfiles, the
// Rendered / Source toggle and its memory, anchors, PDFs and the English labels
// (components/FilesView), listing and reading rules (files.test.ts, filesProtected.test.ts).
// What stays needs the browser and the server together: images decoded from the folder, the
// sanitised Markdown in the page, scrolling a long list, and downloads.
const DIAGRAM = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="90" viewBox="0 0 360 90"><rect width="360" height="90" fill="#14171d"/><g fill="none" stroke="#b18cff" stroke-width="2"><rect x="12" y="25" width="90" height="40"/><rect x="135" y="25" width="90" height="40"/><rect x="258" y="25" width="90" height="40"/><path d="M102 45h33M225 45h33"/></g><g fill="#d8dce6" font-family="monospace" font-size="12" text-anchor="middle"><text x="57" y="49">sensor</text><text x="180" y="49">queue</text><text x="303" y="49">lamp</text></g></svg>`
const README = [
  '# Lantern',
  '',
  'A small **fictional** service that turns sensor readings into lamp colours. See [setup](docs/setup.md), the [changelog](/CHANGELOG.md#v0-3-0) or [the project page](https://example.com/lantern).',
  '',
  '![Data flow](docs/diagram.svg)',
  '',
  '## Status',
  '',
  '- [x] Read the sensors',
  '- [x] Queue the readings',
  '- [ ] Dim the lamps at night',
  '',
  '> Readings older than a minute are dropped.',
  '',
  '## Settings',
  '',
  '| Name | Default | Unit | Range | Applies to | Notes |',
  '| ---- | ------- | ---- | ----- | ---------- | ----- |',
  '| `poll_interval` | 5 | seconds | 1–60 | every sensor | Lower values drain batteries faster |',
  '| `max_brightness` | 80 | percent | 0–100 | every lamp | Capped at night by the dimmer |',
  '',
  '## Run it',
  '',
  '```bash',
  '# start the service',
  'lantern serve --port 8080',
  '```',
  '',
  '```ts',
  'export function colour(reading: number): string {',
  '  return reading > 30 ? "red" : "green" // warm or calm',
  '}',
  '```',
  '',
  '<style>.agent-top{display:none}</style><img src="x" alt="probe" onerror="alert(1)">',
].join('\n')
const SETUP = '# Setup\n\n1. Install the service.\n2. Copy `lantern.toml` next to it.\n\nBack to the [overview](../README.md).\n'
const REVIEW_CSV = 'notes/login-review.csv'
const REVIEW_CSV_TEXT = 'screen,issue\r\nlogin,clipped button\r\n'
const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${fill}"/></svg>`

function write(root: string, files: Record<string, string>) {
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), body)
  }
}
// The menu of a path in a reply: a bottom sheet on the phone.
const action = (page: Page, name: string) => page.locator('.hw-sheet').getByRole('button', { name, exact: true })
async function browse(page: Page) {
  await page.locator('.agent-top').getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Browse files', exact: true }).or(page.getByRole('button', { name: 'Browse files', exact: true })).click()
}
const agent = (core: FakeCore) => core.claude('lantern', [
  ['user', 'Where is the review?'],
  ['assistant', `The login button is clipped.\n\nThe review is in \`${REVIEW_CSV}\`.`],
])

test('a Markdown file is shown formatted and sanitised with its own images, links and Refresh; a file named in a reply previews and downloads', async ({ page, core }) => {
  const claude = agent(core)
  write(claude.cwd, { 'README.md': README, 'docs/setup.md': SETUP, 'docs/diagram.svg': DIAGRAM, [REVIEW_CSV]: REVIEW_CSV_TEXT })
  page.on('dialog', d => { throw new Error(`unexpected dialog: ${d.message()}`) })
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('The login button is clipped.')).toBeVisible()
  await browse(page)
  await page.locator('.files-entry', { hasText: 'README.md' }).click()
  const doc = page.locator('.files-md')
  await expect(doc.getByRole('heading', { level: 1, name: 'Lantern' })).toBeVisible()
  await expect(doc.locator('.code-block .hl-k', { hasText: 'export' })).toBeVisible()
  // The image is read from the folder by the server, never from the app's address, and decodes.
  const diagram = doc.locator('img[alt="Data flow"]')
  await expect(diagram).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/)
  await expect.poll(() => diagram.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  // The file's raw HTML neither restyles the app nor runs anything.
  await expect(doc.locator('style')).toHaveCount(0)
  await expect(page.locator('.agent-top')).toBeVisible()
  await expect(doc.locator('img[alt="probe"]')).not.toHaveAttribute('onerror')
  // A wide table scrolls by itself; the page never scrolls sideways.
  const sizes = await doc.locator('table').evaluate(t => ({ scroll: t.scrollWidth, client: t.clientWidth, page: document.documentElement.scrollWidth, view: innerWidth }))
  expect(sizes.page).toBeLessThanOrEqual(sizes.view)
  expect(sizes.scroll).toBeGreaterThan(sizes.client)
  // A relative link opens the other file here, in its folder; Refresh reads its image again.
  await doc.getByRole('link', { name: 'setup' }).click()
  await expect(page.locator('.files-md').getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible()
  await expect(page.locator('.files-crumb').nth(1)).toHaveText('docs')
  await page.locator('.files-md').getByRole('link', { name: 'overview' }).click()
  await expect(diagram).toHaveAttribute('src', `data:image/svg+xml;base64,${Buffer.from(DIAGRAM).toString('base64')}`)
  write(claude.cwd, { 'docs/diagram.svg': svg('green') })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(diagram).toHaveAttribute('src', `data:image/svg+xml;base64,${Buffer.from(svg('green')).toString('base64')}`)
  await page.keyboard.press('Escape')
  await expect(page.locator('.files-view')).toHaveCount(0)

  // A path in a reply: Preview reads it on the agent's machine, Download saves it intact.
  const link = page.locator('.chat .md-path', { hasText: REVIEW_CSV })
  await link.click()
  await action(page, 'Preview').click()
  const sheet = page.locator('.hw-sheet').filter({ has: page.locator('.files-view') })
  await expect(sheet.locator('.files-text')).toContainText('login,clipped button')
  await expect(sheet.locator('.changes-location')).toContainText(`/projects/lantern/${REVIEW_CSV}`)
  const fromPreview = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Download', exact: true }).click()
  const saved = await fromPreview
  expect(saved.suggestedFilename()).toBe('login-review.csv')
  expect(fs.readFileSync(await saved.path(), 'utf8')).toBe(REVIEW_CSV_TEXT)
})

test('the last file of a 1500-file folder is reached by scrolling and opens', async ({ page, core }) => {
  const COUNT = 1500
  const name = (i: number) => `note-${String(i).padStart(4, '0')}.md`
  const claude = core.claude('inbox', [['user', 'Are you ready?'], ['assistant', 'Ready when you are.']])
  write(claude.cwd, Object.fromEntries(Array.from({ length: COUNT }, (_, i) => [name(i + 1), i + 1 === COUNT ? 'last file\n' : `note ${i + 1}\n`])))
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  await browse(page)
  const entries = page.locator('.files-entry')
  await expect(entries).toHaveCount(COUNT)
  const first = entries.first()
  const last = entries.last()
  await expect(first).toBeInViewport()
  await expect(last).not.toBeInViewport()
  // The scroll container nearest to the list is the one that scrolls.
  const room = await first.evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p.scrollHeight - p.clientHeight
    return 0
  })
  expect(room).toBeGreaterThan(1000)
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  await last.click()
  await expect(page.locator('.files-md')).toHaveText('last file')
  await expect(page.locator('.files-crumb.current')).toHaveText(name(COUNT))
})
