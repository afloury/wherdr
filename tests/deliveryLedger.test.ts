import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { DeliveryLedger } from '../server/utils/deliveryLedger'

const root = os.tmpdir()
fs.mkdirSync(root, { recursive: true })
const dirs: string[] = []
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
function file() {
  const dir = fs.mkdtempSync(path.join(root, 'delivery-'))
  dirs.push(dir)
  return path.join(dir, 'deliveries.json')
}
it('delivers text and attachment once across concurrent reconnects and server restart', async () => {
  const store = file()
  const ledger = new DeliveryLedger<string>(store)
  const typed = vi.fn(async (_text: string) => 'queued')
  const text = 'Inspect the screenshot\n/cache/uploads/example.jpg'
  const send = () => typed(text)
  expect(await Promise.all([ledger.run('pane:send-1', 'uncertain', send), ledger.run('pane:send-1', 'uncertain', send)])).toEqual(['queued', 'queued'])
  const restarted = new DeliveryLedger<string>(store)
  expect(await restarted.run('pane:send-1', 'uncertain', send)).toBe('queued')
  expect(typed).toHaveBeenCalledExactlyOnceWith(text)
  await restarted.run('pane:send-2', 'uncertain', send)
  expect(typed).toHaveBeenCalledTimes(2)
})
it('commits before typing and never repeats an interrupted or ambiguous delivery', async () => {
  const store = file()
  const ledger = new DeliveryLedger<string>(store)
  const typed = vi.fn(async () => {
    expect(JSON.parse(fs.readFileSync(store, 'utf8'))['send-1']).toBe('uncertain')
    throw new Error('connection lost after terminal accepted text')
  })
  await expect(ledger.run('send-1', 'uncertain', typed)).rejects.toThrow('connection lost')
  expect(await new DeliveryLedger<string>(store).run('send-1', 'uncertain', typed)).toBe('uncertain')
  expect(typed).toHaveBeenCalledOnce()
})
it('fails closed for corrupt receipts rather than resending', () => {
  const store = file()
  fs.writeFileSync(store, '{')
  expect(() => new DeliveryLedger(store)).toThrow()
})
it('deduplicates the actual prompt endpoint after a lost response and reconnect', async () => {
  const store = file()
  let ledger = new DeliveryLedger<{ ok: boolean, queued?: unknown }>(store)
  const typed = vi.fn(async () => {})
  vi.stubGlobal('defineApi', (handler: unknown) => handler)
  vi.stubGlobal('PANE_RE', /^w1:p1$/)
  vi.stubGlobal('promptOnce', (pane: string, id: string, _text: string, send: () => Promise<{ ok: boolean }>) => ledger.run(`${pane}:${id}`, { ok: true }, send))
  vi.stubGlobal('keepPastes', () => {})
  vi.stubGlobal('restarting', () => false)
  vi.stubGlobal('findPane', () => undefined)
  vi.stubGlobal('withPaneLock', async (_pane: string, work: () => unknown) => work())
  vi.stubGlobal('closePanel', async () => false)
  vi.stubGlobal('agentPrompt', typed)
  vi.stubGlobal('addQueued', (_pane: string, text: string, options: { id: string }) => ({ id: options.id, text, at: Date.now() }))
  vi.stubGlobal('setTimeout', () => {})
  vi.stubGlobal('poll', () => {})
  const { default: prompt } = await import('../server/api/prompt.post')
  const body = { pane_id: 'w1:p1', client_id: 'w-example', text: 'Inspect image\n/cache/uploads/example.jpg' }
  const first = await prompt({} as never, body)
  ledger = new DeliveryLedger(store)
  expect(await prompt({} as never, body)).toEqual(first)
  expect(typed).toHaveBeenCalledExactlyOnceWith(body.pane_id, body.text)
})
