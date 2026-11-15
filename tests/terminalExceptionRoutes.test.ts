import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyScreen, usesTerminalException } from '../shared/interactiveScreen'
import { screenChoices } from '../server/utils/choices'

const fx = (file: string) => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')

describe('the classifier keeps the terminal exception scope', () => {
  for (const agent of ['claude', 'codex', 'omp']) for (const status of ['idle', 'blocked', 'unknown', 'working']) {
    it(`${agent}/${status}: active two-column Usage menu`, () => {
      const text = fx('codex-usage-menu.txt')
      const expected = agent === 'codex' && status !== 'unknown' && status !== 'working'
      const choices = screenChoices(text, agent)
      expect(usesTerminalException({ text, agent, status })).toBe(expected)
      // omp does not recognize this Codex list, so it cannot offer an answer.
      if (!choices) return
      expect(classifyScreen({ text, agent, status, choices }) === 'terminal').toBe(expected)
    })
  }
  for (const file of ['codex-approve-command.txt', 'codex-approve-edits.txt']) {
    for (const quote of ['Agent Command Center', fx('codex-command-center.txt'), fx('codex-usage-menu.txt')]) {
      it(`${file}: preserves native approval below a quoted title or old menu (${quote.split('\n')[0]})`, () => {
        const text = `${quote}\n\n${fx(file)}`
        const choices = screenChoices(text, 'codex')
        expect(classifyScreen({ text, agent: 'codex', status: 'blocked', choices })).toBe('native')
      })
    }
  }
})
