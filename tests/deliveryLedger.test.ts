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
