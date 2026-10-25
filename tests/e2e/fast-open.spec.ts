import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page, type Route } from './test'
import { CLAUDE_SUGGEST_PANE, SOCK_FILE } from './scenario.mjs'

// Opening the Board and a conversation fast: what this device kept shows at once
// (with "Read at" while the network catches up), the shapes of what loads after
// 300 ms when nothing is kept, and a long conversation from its bottom first.
const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `.shots/fast-open-${name}-${project}.png` })
const later = (ms: number) => (route: Route) => setTimeout(() => route.continue().catch(() => {}), ms)

// ------------------------------------------------------------ the Board
const row = (id: string, group: string) => ({
  id, repo: id.split('/')[0], n: Number(id.split('/')[1]), state: group === 'working' ? 'working' : 'idle', kind: '', stage: group, title: `Task ${id}`, msg: '',
  app: 'claude', progress: null, eta: null, pr: '', review: null, reviewRound: 0, research: false, archived: false, queue: null, group,
})
const board = { version: 'v-fast', machines: [{ machine: '', status: 'ready', version: '1.2.1', at: Date.now(), tasks: [row('demo/1', 'working'), row('demo/2', 'todo')] }] }
const tasksAfter = (ms: number) => (route: Route) => setTimeout(() => route.fulfill({ json: board }).catch(() => {}), ms)

test('the Board: its shapes while nothing is kept, then the last board at once with when it was read', async ({ page }, testInfo) => {
  await page.route('**/api/tasks*', tasksAfter(1500))
  await page.goto('/#/board')
  // Nothing kept: the column heads and empty cards, no "Loading…".
  const skel = page.locator('.board-skel')
  await expect(skel).toBeVisible()
  await expect(skel.locator('.skel-card').first()).toBeVisible()
  await expect(page.getByText('Loading…')).toHaveCount(0)
  await shot(page, 'board-skeleton', testInfo.project.name)
  // (On a phone, one column at a time: the cards are there, not all in view.)
  await expect(page.locator('.task-card', { hasText: 'Task demo/1' })).toHaveCount(1)
  await expect(skel).toHaveCount(0)
  // Kept on this device: shown at once after a reload, "Read at" until the read answers.
  await page.waitForTimeout(2500)
  await page.unroute('**/api/tasks*')
  await page.route('**/api/tasks*', tasksAfter(2500))
  await page.reload()
  await expect(page.locator('.board-cached-tag')).toContainText(/Read at \d/)
  await expect(page.locator('.task-card')).toHaveCount(2)
  await expect(page.locator('.board-skel')).toHaveCount(0)
  await shot(page, 'board-cached', testInfo.project.name)
  await expect(page.locator('.board-cached-tag')).toHaveCount(0, { timeout: 6000 })
})

test('a short Board read shows no skeleton at all', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { skel: boolean }).skel = false
    new MutationObserver(() => { if (document.querySelector('.board-skel')) (window as unknown as { skel: boolean }).skel = true })
      .observe(document.documentElement, { subtree: true, childList: true })
  })
  await page.route('**/api/tasks*', tasksAfter(100))
  await page.goto('/#/board')
  await expect(page.locator('.task-card')).toHaveCount(2)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as unknown as { skel: boolean }).skel)).toBe(false)
})

// ------------------------------------------------------------ a conversation
// A longer conversation in place of the nightly one, put back afterwards.
const home = path.join(path.dirname(fs.readFileSync(SOCK_FILE, 'utf8').trim()), 'home')
const cwd = path.join(home, 'projects/nightly')
const sid = '00000000-0000-4000-8000-000000000019'
const file = path.join(home, '.claude/projects', cwd.replace(/[/.]/g, '-'), `${sid}.jsonl`)
let original = ''
const TURNS = 12
test.beforeAll(() => {
  original = fs.readFileSync(file, 'utf8')
  const base = { isSidechain: false, cwd, sessionId: sid }
  const start = Date.now() - 3600_000
  const lines: unknown[] = []
  let t = start
  for (let i = 1; i <= TURNS; i++) {
    lines.push({ ...base, type: 'user', timestamp: new Date(t += 5000).toISOString(), message: { role: 'user', content: `Question ${i}: check step ${i}.` } })
    for (let k = 0; k < 2; k++) {
      const id = `toolu_${i}_${k}`
      lines.push({ ...base, type: 'assistant', timestamp: new Date(t += 1000).toISOString(), message: { model: 'claude-opus-4-1', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: `npm test -- step-${i}` } }] } })
      lines.push({ ...base, type: 'user', timestamp: new Date(t += 1000).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })
    }
    lines.push({ ...base, type: 'assistant', timestamp: new Date(t += 1000).toISOString(), message: { model: 'claude-opus-4-1', role: 'assistant', content: [{ type: 'text', text: `Step ${i} passes.${i === TURNS ? ' All steps done.' : ''}` }] } })
  }
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
})
test.afterAll(() => { if (original) fs.writeFileSync(file, original) })

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('typewriterSpeed', 'off')
    // How many user messages were on the page when the last reply first showed.
    const w = window as unknown as { firstUsers: number | null }
    w.firstUsers = null
    // Observe the first DOM commit before idle callbacks can add more blocks.
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.chat-list')?.textContent?.includes('All steps done.')) return
      w.firstUsers = document.querySelectorAll('.chat-list .msg-user-wrap').length
      observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  await page.goto(`/#/a/${CLAUDE_SUGGEST_PANE}`)
}

test('a long conversation shows its end first, then the rest above without moving the bottom', async ({ page }) => {
  await open(page)
  const list = page.locator('.chat-list')
  await expect(list).toContainText('All steps done.', { timeout: 15000 })
  const first = await page.evaluate(() => (window as unknown as { firstUsers: number }).firstUsers)
  expect(first).toBeGreaterThan(0)
  expect(first).toBeLessThan(TURNS)
  // The rest follows above while the page is idle; the bottom stays where it is.
  await expect(list.locator('.msg-user-wrap')).toHaveCount(TURNS, { timeout: 10000 })
  await expect(list).toContainText('Question 1: check step 1.')
  const gap = await page.locator('.chat').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
  expect(gap).toBeLessThan(160)
})

test('a conversation: its shapes while nothing is kept, then the end kept at once with when it was read', async ({ page }, testInfo) => {
  await page.route('**/api/chat?*', (route) => {
    if (new URL(route.request().url()).searchParams.get('pane') === CLAUDE_SUGGEST_PANE) return later(1500)(route)
    return route.continue()
  })
  await open(page)
  const skel = page.locator('.chat-skel')
  await expect(skel).toBeVisible()
  // The field is real and usable meanwhile.
  await expect(page.locator('.prompt textarea').first()).toBeEditable()
  await shot(page, 'chat-skeleton', testInfo.project.name)
  await expect(page.locator('.chat-list')).toContainText('All steps done.', { timeout: 15000 })
  await expect(skel).toHaveCount(0)
  // Kept on this device (written within a few seconds): at once after a reload,
  // "Read at" while the network is slow, gone once it answers.
  await page.waitForTimeout(3000)
  await page.unroute('**/api/chat?*')
  await page.route('**/api/chat?*', later(2500))
  await page.reload()
  await expect(page.locator('.chat-list')).toContainText('All steps done.', { timeout: 2000 })
  await expect(page.locator('.chat-skel')).toHaveCount(0)
  await expect(page.locator('.chat-cached')).toContainText(/Read at \d/)
  await shot(page, 'chat-cached', testInfo.project.name)
  await expect(page.locator('.chat-cached')).toHaveCount(0, { timeout: 6000 })
})

test('a fresh empty conversation wins over an older cache that arrives later', async ({ page }) => {
  await open(page)
  await expect(page.locator('.chat-list')).toContainText('All steps done.')
  await page.waitForTimeout(3000)
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key) {
      const request = get.call(this, key)
      if (this.name !== 'chats') return request
      // Delay only delivery of the cached conversation, not the network.
      return new Proxy(request, {
        get(target, name) { return Reflect.get(target, name, target) },
        set(target, name, value) {
          if (name === 'onsuccess') {
            target.onsuccess = event => setTimeout(() => value.call(target, event), 1200)
            return true
          }
          return Reflect.set(target, name, value, target)
        },
      })
    }
  })
  let answered = false
  await page.route('**/api/chat?*', async route => {
    if (new URL(route.request().url()).searchParams.get('pane') !== CLAUDE_SUGGEST_PANE) return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ json: { ...body, available: true, unchanged: false, items: [], start: 0 } })
    answered = true
  })
  await page.reload()
  await expect.poll(() => answered).toBe(true)
  await page.waitForTimeout(1800)
  await expect(page.locator('.chat-list')).not.toContainText('All steps done.')
  await expect(page.locator('.chat-cached')).toHaveCount(0)
})
