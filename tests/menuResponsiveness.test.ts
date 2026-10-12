import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { terminalException } from '../shared/interactiveScreen'
import { parseMenu } from '../shared/menuScreen'
import { activeTab } from '../server/utils/settingstabs'
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
it('focuses the tab bar before switching from the config list', async () => {
  let tab = 'Config', focused = false
  const keys: string[] = []
  const call = vi.fn(async (method: string, params: any) => {
    if (method === 'pane.send_input') {
      keys.push(...params.keys)
      if (params.keys[0] === 'up') focused = true
      if (params.keys[0] === 'left' && focused) tab = 'Status'
      return {}
    }
    return { read: { text: `Settings  ${tab === 'Status' ? '\x1b[7mStatus\x1b[0m  Config' : 'Status  \x1b[7mConfig\x1b[0m'}  Usage  Stats\n${focused ? '↑ to tabs' : '❯ Auto-compact true\nType to filter · Enter/↓ to select · ↑ to tabs · Esc to clear'}` } }
  })
  for (const [k, v] of Object.entries({ defineApi: (h: unknown) => h, PANE_RE: /^w1:p1$/, HerdrError,
    findPane: () => ({ agent: 'claude' }), herdr: call, activeTab, sleep: async () => {}, choicesCache: { delete: vi.fn() } })) vi.stubGlobal(k, v)
  await (await import('../server/api/settings-tab.post')).default({}, { pane_id: 'w1:p1', target: 'Status' })
  expect(keys).toEqual(['up', 'left'])
  expect(tab).toBe('Status')
})
