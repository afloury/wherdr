import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyScreen, usesTerminalException } from '../shared/interactiveScreen'
import { keysFor, screenChoices } from '../server/utils/choices'
import { HerdrError } from '../server/utils/herdr'

const fx = (file: string) => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

// Execute the actual endpoint, with only its transport/framework bindings faked.
async function choose(text: string, agent: string, status: string) {
  const pane = { id: 'w1:p1', agent, status }
  const choices = screenChoices(text, agent)!
  expect(choices).toBeTruthy()
  const call = vi.fn(async () => ({ read: { text } }))
  vi.useFakeTimers()
  for (const [name, value] of Object.entries({
    defineApi: (handler: unknown) => handler, PANE_RE: /^w1:p1$/, HerdrError,
    findPane: () => pane, herdr: call, screenChoices, keysFor,
    transcripts: { pendingClaudeQuestions: async () => [] },
    choicesCache: new Map(), poll: () => {},
  })) vi.stubGlobal(name, value)
  const { default: handler } = await import('../server/api/choose.post')
  return { call, result: () => handler({}, { pane_id: pane.id, index: 0, label: choices.options[0]!.label, identity: choices.identity }) }
}

describe('the classifier and native answer route share the terminal exception scope', () => {
  for (const agent of ['claude', 'codex', 'omp']) for (const status of ['idle', 'blocked', 'unknown', 'working']) {
    it(`${agent}/${status}: active two-column Usage menu`, async () => {
      const text = fx('codex-usage-menu.txt')
      const expected = agent === 'codex' && status !== 'unknown' && status !== 'working'
      const choices = screenChoices(text, agent)
      expect(usesTerminalException({ text, agent, status })).toBe(expected)
      // omp does not recognize this Codex list, so it cannot offer an answer.
      if (!choices) return
      expect(classifyScreen({ text, agent, status, choices }) === 'terminal').toBe(expected)
      const endpoint = await choose(text, agent, status)
      if (expected) {
        await expect(endpoint.result()).rejects.toMatchObject({ code: 'stale' })
        expect(endpoint.call).toHaveBeenCalledTimes(1) // screen read, no key
      } else {
        await expect(endpoint.result()).resolves.toEqual({ ok: true })
        expect(endpoint.call).toHaveBeenCalledWith('pane.send_input', expect.anything())
      }
    })
  }
  for (const file of ['codex-approve-command.txt', 'codex-approve-edits.txt']) {
    for (const quote of ['Agent Command Center', fx('codex-command-center.txt'), fx('codex-usage-menu.txt')]) {
      it(`${file}: preserves native approval below a quoted title or old menu (${quote.split('\n')[0]})`, async () => {
        const text = `${quote}\n\n${fx(file)}`
        const choices = screenChoices(text, 'codex')
        expect(classifyScreen({ text, agent: 'codex', status: 'blocked', choices })).toBe('native')
        const endpoint = await choose(text, 'codex', 'blocked')
        await expect(endpoint.result()).resolves.toEqual({ ok: true })
        expect(endpoint.call).toHaveBeenCalledWith('pane.send_input', expect.anything())
      })
    }
  }
})
