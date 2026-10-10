import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyScreen, confirmedInput, nativePrompt } from '../shared/interactiveScreen'
import { parseChoices, parseOmpPrompt } from '../server/utils/choices'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const classify = (text: string, agent = 'codex') => classifyScreen({ text, choices: agent === 'omp' ? parseOmpPrompt(text) : parseChoices(text, { strict: true }) })

describe('conservative interactive screen presentation', () => {
  it('keeps a simple continuous numbered list native', () => {
    expect(classify('Choose a colour?\n\n› 1. Red\n  2. Blue\n\nenter select · esc back')).toBe('native')
    expect(classify(fx('claude-trust.txt'))).toBe('native')
  })
  it('rejects the two columns in Codex usage instead of gluing them', () => {
    const text = fx('codex-usage-menu.txt')
    expect(parseChoices(text)?.options[0]?.label).toContain('Usage history')
    expect(classify(text)).toBe('terminal')
    expect(confirmedInput(text)).toBe(false)
  })
  it.each(['codex-model-1.txt', 'claude-ask.txt', 'claude-settings-stats.txt', 'omp-selector.txt', 'omp-ask-tabs.txt'])(
    'leaves the complex real screen %s in the terminal', name => {
      expect(classify(fx(name), name.startsWith('omp') ? 'omp' : 'claude')).toBe('terminal')
    },
  )
  it('keeps a recognized omp yes/no tool approval and its command native', () => {
    expect(classify(fx('omp-approve-bash.txt'), 'omp')).toBe('native')
  })
  it.each(['codex-idle.txt', 'claude-idle.txt', 'omp-fresh-nerd.txt', 'omp-idle-footer.txt'])(
    'confirms the real message field in %s', name => { expect(confirmedInput(fx(name))).toBe(true) },
  )
  it('rejects gaps, descriptions, multiple cursors, unnumbered options and inline columns', () => {
    for (const text of [
      '› 1. One\n  3. Three',
      '› 1. One\n     A description\n  2. Two',
      '› 1. One\n› 2. Two',
      '› One\n  Two\n\nenter select · esc back',
      '› 1. One  Help\n  2. Two  More help',
      '› 1. One\n  2. Two\n     Help',
    ]) expect(classify(text)).toBe('terminal')
  })
  it('does not treat an empty or failed read as a message field', () => {
    expect(classifyScreen({ text: '' })).toBe('unknown')
    expect(classifyScreen({ text: 'Thinking…', status: 'working' })).toBe('working')
    expect(classifyScreen({ text: fx('codex-idle.txt'), status: 'working' })).toBe('input')
  })
  it('allows only an explicitly recognized, already-open free answer', () => {
    expect(nativePrompt('Answer:', { question: 'Why?', cursor: 0, typing: true, options: [{ label: 'Other', hint: null, free: true }] })).toBe(true)
    expect(nativePrompt('Answer:', { question: 'Why?', cursor: 0, typing: true, options: [{ label: 'Other', hint: null }] })).toBe(false)
  })
})
