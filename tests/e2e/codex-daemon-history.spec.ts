import { expect, test } from './test'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { CODEX_UPDATE_PANE, CODEX_UPDATE_SESSION, SOCK_FILE, fakeHerdr } from './scenario.mjs'

test('a paginated Codex conversation is read from the shared daemon without terminal input', async ({ page }) => {
  // The launcher supplies an invented HOME, never a user's existing daemon.
  const home = path.join(path.dirname(fs.readFileSync(SOCK_FILE, 'utf8')), 'home')
  const socket = path.join(home, '.codex/app-server-control/app-server-control.sock')
  fs.mkdirSync(path.dirname(socket), { recursive: true })
  const cwd = (await fakeHerdr('e2e.pane_field', { pane_id: CODEX_UPDATE_PANE, field: 'cwd' })).value
  const methods: string[] = []
  let unavailable = false
  const history = Array.from({ length: 250 }, (_, i) => ({
    startedAtMs: 1000 + i,
    item: i === 248
      ? { id: `item-${i}`, type: 'userMessage', content: [{ type: 'text', text: 'Read the current history.' }] }
      : { id: `item-${i}`, type: 'agentMessage', text: i === 249 ? 'This reply is stored in the shared daemon.' : `History message ${i}.` },
  }))
  const server = createServer()
  const ws = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => ws.handleUpgrade(request, socket, head, client => ws.emit('connection', client)))
  ws.on('connection', client => client.on('message', bytes => {
    const message = JSON.parse(bytes.toString())
    methods.push(message.method)
    if (unavailable && message.id !== undefined && message.method !== 'initialize') {
      client.send(JSON.stringify({ id: message.id, error: { message: 'Temporary daemon read failure' } }))
      return
    }
    let result: object = {}
    if (message.method === 'thread/read') result = { thread: {
      id: CODEX_UPDATE_SESSION, name: 'Build review', cwd,
      historyMode: 'paginated', model: 'test-model',
    } }
    if (message.method === 'thread/items/list') {
      const end = message.params.cursor == null ? history.length : Number(message.params.cursor)
      const start = Math.max(0, end - Number(message.params.limit))
      result = { data: history.slice(start, end).reverse(), nextCursor: start ? String(start) : null }
    }
    if (message.id !== undefined) client.send(JSON.stringify({ id: message.id, result }))
  }))
  await new Promise<void>(resolve => server.listen(socket, resolve))
  try {
    await fakeHerdr('e2e.update_session', { pane_id: CODEX_UPDATE_PANE, session: CODEX_UPDATE_SESSION })
    const before = await fakeHerdr('e2e.terminal_screen', { pane_id: CODEX_UPDATE_PANE })
    await page.goto(`/#/a/${CODEX_UPDATE_PANE}`)
    await expect(page.locator('.chat').getByText('This reply is stored in the shared daemon.')).toBeVisible()
    await expect(page.locator('.chat').getByText('Read the current history.')).toBeVisible()
    await expect(page.locator('.chat').getByText('No conversation for this agent yet.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Load earlier messages' })).toBeEnabled()
    // Scrolling to the button itself triggers infinite scroll before a click.
    await page.locator('.chat').evaluate(el => el.scrollTo({ top: 0 }))
    await expect(page.locator('.chat').getByText('History message 50.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load earlier messages' })).toBeEnabled()
    await page.locator('.chat').evaluate(el => el.scrollTo({ top: 0 }))
    await expect(page.locator('.chat').getByText('History message 0.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0)
    const url = `/api/chat?pane=${encodeURIComponent(CODEX_UPDATE_PANE)}`
    const current = await (await page.request.get(url)).json()
    const query = new URLSearchParams({ since: current.token, from: String(current.start) })
    unavailable = true
    const stale = await (await page.request.get(`${url}&${query}`)).json()
    expect(stale).toMatchObject({ available: true, file: current.file, stale: true, unchanged: true })
    await expect(page.locator('.chat').getByText('History message 0.', { exact: true })).toBeVisible()
    unavailable = false
    const recovered = await (await page.request.get(`${url}&${query}`)).json()
    expect(recovered).toMatchObject({ file: current.file, unchanged: true })
    const after = await fakeHerdr('e2e.terminal_screen', { pane_id: CODEX_UPDATE_PANE })
    expect(after.keys).toEqual(before.keys)
    expect(methods).toContain('thread/items/list')
    expect(methods.every(method => ['initialize', 'initialized', 'thread/read', 'thread/items/list'].includes(method))).toBe(true)
  } finally {
    for (const client of ws.clients) client.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
    ws.close()
  }
})
