import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fixture, startCore } from './core'

// v3 journey on core agents (CI on pull requests to v3): the home loads from the
// fake core, the agent opens, a file attached from the conversation is put on its
// machine, the phone key bar's navigation keys reach core by the names terminal.keys
// accepts (home, pageup…, not v2 Herdr's CSI bytes), and the terminal attaches.
// An idle Devin then keeps Conversation visible without a terminal overlay.
// Merges the former core-attach and core-keybar specs: same agent, same opening steps.
// Also runs on webkit-phone (playwright.config.ts): the events WebSocket must open and
// deliver a state frame there, since iOS Safari can reject a handshake Chromium accepts.
test('core smoke: home, conversation attach and key bar, terminal attach', async ({ page }, testInfo) => {
  const terminal = fixture.inventory.terminals[0]!
  const devin = { ...terminal, address: 'host-a/t8', name: 'devin-idle-agent', template: 'devin', argv: ['devin', '-r', 'devin-idle'], status: 'idle' }
  const idle = readFileSync(new URL('../fixtures/core-screens/devin-idle.txt', import.meta.url), 'utf8')
  const transcript = Buffer.from(JSON.stringify({ schema_version: 'ATIF-v1.7', session_id: 'devin-idle', steps: [{ step_id: 1, source: 'agent', message: 'Saved Devin reply' }] }))
  const file = '/home/user/.local/share/devin/cli/transcripts/devin-idle.json'
  const core = await startCore(call =>
    call.method === 'terminal.list' ? { ...fixture.inventory, terminals: [terminal, devin].map(t => ({ ...t, labels: { 'herdr.space': 'sp1', 'herdr.tab': 'tbA' } })) }
    : call.method === 'terminal.read' && call.params.terminal === devin.address ? { text: idle }
    : call.method === 'terminal.get' && call.params.terminal === devin.address ? { pid: 42424242, argv: devin.argv }
    : call.method === 'machine.exec' ? (() => {
      const argv = call.params.argv as string[]
      const script = argv[2] || ''
      const stdout = script === 'printf %s "$HOME"' ? Buffer.from('/home/user')
        : argv.includes(file) ? script.includes('tail -c')
          ? transcript.subarray(Number(argv[5]) - 1, Number(argv[5]) - 1 + Number(argv[6]))
          : Buffer.from(`${transcript.length} 1767225601.000000000 1 regular file\n`)
          : Buffer.alloc(0)
      return { code: 0, stdout: stdout.toString('base64'), stderr: '' }
    })()
    : call.method === 'doc.get' ? { value: call.params.on ? null : { spaces: [{ id: 'sp1', name: 'Demo', folder: '/workspace/demo', tabs: [{ id: 'tbA', name: 'Main' }] }] }, version: 1 }
    : call.method === 'terminal.put' ? { path: `/remote/${call.params.name}` }
    : call.method === 'terminal.keys' ? { status: null, turn: 0 }
    : undefined)
  // Agents in the latest state frame of /ws/events (pongs and settings messages have no panes).
  let eventsPanes = -1
  page.on('websocket', (ws) => {
    if (!new URL(ws.url()).pathname.endsWith('/ws/events')) return
    ws.on('framereceived', ({ payload }) => {
      try {
        const data = JSON.parse(String(payload))
        if (Array.isArray(data?.panes)) eventsPanes = data.panes.length
      } catch { /* not JSON */ }
    })
  })
  try {
    await core.open(page)
    await expect.poll(() => eventsPanes, { message: '/ws/events opens and sends a state frame with the agent' }).toBeGreaterThan(0)
    await expect(page.locator('.home-version')).toHaveText(/^wherdr v3 · herdr-core$/i)
    await page.getByRole('button', { name: /review-agent/ }).first().click()
    await expect(page).toHaveURL(/#\/(a|t)\//)
    await expect(page.locator('.agent-top')).toBeVisible()
    const toChat = page.getByRole('button', { name: 'Conversation', exact: true })
    if (await toChat.count() && await toChat.getAttribute('aria-pressed') === 'false') await toChat.click()

    // '+' → file: the path lands in the message, on the agent's own pane.
    await page.getByTestId('attach-any').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect.poll(() => core.calls.filter(c => c.method === 'terminal.put').map(c => c.params.terminal)).toContain(terminal.address)
    await expect(page.getByText('notes.txt')).toBeVisible()
    expect(page.url()).toMatch(/s[0-9a-z]+:p/)
    await expect(page.getByText('Invalid pane')).toHaveCount(0)

    // Key bar from the conversation (no terminal attached): one key proves the chain
    // button → /api/input → terminal.keys. Every key's name is checked lower, in
    // tests/keybarKeys.test.ts and tests/core-input.test.ts.
    await page.getByRole('button', { name: 'Show or hide terminal keys', exact: true }).click()
    const bar = page.getByRole('group', { name: 'Terminal function keys', exact: true })
    const response = page.waitForResponse(r => r.url().endsWith('/api/input') && r.request().method() === 'POST')
    await bar.getByRole('button', { name: 'PgUp', exact: true }).click()
    expect((await response).status()).toBe(200)
    expect(core.calls.filter(c => c.method === 'terminal.keys').map(c => c.params.keys)).toEqual([['pageup']])

    // The terminal view attaches the live terminal.
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect.poll(() => core.framed.filter(c => c.method === 'terminal.attach').map(c => c.params.terminal)).toContain(terminal.address)
    await expect(page.locator('.xterm')).toBeVisible()

    // Core reports this Devin idle. Its ordinary field must keep Conversation
    // visible, rather than mounting the fallback terminal after its debounce.
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: /devin-idle-agent/ }).first().click()
    if (await toChat.count() && await toChat.getAttribute('aria-pressed') === 'false') await toChat.click()
    const reply = page.locator('article').getByText('Saved Devin reply', { exact: true })
    await expect(reply).toBeVisible()
    await expect(page.getByRole('button', { name: 'Photo, file, paste, commands', exact: true })).toBeEnabled()
    await expect.poll(async () => {
      const state = await (await page.request.get(core.url + '/api/state')).json()
      return state.panes.find((p: { coreAddress: string }) => p.coreAddress === devin.address)?.interaction
    }).toBe('input')
    await page.clock.install()
    await page.clock.fastForward(1000)
    await expect(page.locator('.interactive-terminal')).toHaveCount(0)
    await expect(page.locator('.interactive-terminal-reopen')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('devin-idle-phone.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(reply).toBeVisible()
    await expect(page.locator('.interactive-terminal')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('devin-idle-computer.png') })
  } finally {
    await core.stop()
  }
})
