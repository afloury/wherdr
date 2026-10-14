import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { terminalException } from '../shared/interactiveScreen'
import { parseMenu } from '../shared/menuScreen'
import { HerdrError } from '../server/utils/herdr'
const fx = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8')
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
it('recognizes usage with its subtitle and old output above it', () => {
  expect(terminalException('Old MCP tools\n\n' + fx('codex-usage-subtitle.txt'))).toBe(true)
  expect(terminalException(fx('codex-usage-subtitle.txt') + '\nNew question?\n› 1. Yes\n  2. No')).toBe(false)
})
it('sends a native arrow without waiting for any screen read', async () => {
  vi.useFakeTimers()
  const call = vi.fn(async () => ({}))
  for (const [k, v] of Object.entries({ defineApi: (h: unknown) => h, PANE_RE: /^w1:p1$/, HerdrError,
    findPane: () => ({ agent: 'claude', menu: parseMenu(fx('claude-resume.ansi')) }),
    herdr: call, choicesCache: { delete: vi.fn() }, poll: vi.fn(), watchScreen: vi.fn(), refreshNativeScreen: vi.fn() })) vi.stubGlobal(k, v)
  const handler = (await import('../server/api/nav.post')).default
  await handler({}, { pane_id: 'w1:p1', key: 'down' })
  expect(call.mock.calls).toEqual([['pane.send_input', { pane_id: 'w1:p1', keys: ['down'] }]])
})
