// omp's tool approval dialog (select box "Allow tool: …"): read as a question
// with buttons, and messages sent meanwhile held instead of typed into it.
// Fixtures: real omp 18.4 screens captured in a throwaway session
// (--approval-mode always-ask): bash and eval approvals, an eval whose long
// code scrolls the title off the screen, the idle input field.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inputVisible, keysFor, parseOmpPrompt, screenChoices } from '../server/utils/choices'
import { pendingOmpTool } from '../server/utils/promptDetail'
import { shouldHold } from '../server/utils/queued'
import { viaPrompt } from '../shared/sendRoute'
import type { Choices } from '../shared/types'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('omp approval dialog on screen', () => {
  it('reads the tool, its input and the Approve / Deny options', () => {
    expect(screenChoices(fx('omp-approve-bash.txt'), 'omp')).toEqual({
      question: 'Allow tool: bash',
      cursor: 0,
      options: [{ label: 'Approve', hint: null }, { label: 'Deny', hint: null }],
      detail: { tool: 'bash', command: 'Command: echo hello > out.txt' },
    })
    const evalc = screenChoices(fx('omp-approve-eval.txt'), 'omp')!
    expect(evalc.question).toBe('Allow tool: eval')
    expect(evalc.detail).toEqual({ tool: 'eval', command: 'Language: python\nCode:\nprint(6*7)' })
  })
  it('follows the cursor, and answers with arrows then Enter', () => {
    const moved = fx('omp-approve-bash.txt').replace('│  ❯ Approve', '│    Approve').replace('│    Deny ', '│  ❯ Deny ')
    const c = parseOmpPrompt(moved)!
    expect(c.cursor).toBe(1)
    expect(keysFor(c, 0)).toEqual(['up', 'enter'])
    expect(keysFor(parseOmpPrompt(fx('omp-approve-bash.txt'))!, 1)).toEqual(['down', 'enter'])
  })
  it('long input: title scrolled off, still an approval with the visible input', () => {
    const c = parseOmpPrompt(fx('omp-approve-long.txt'))!
    expect(c.question).toBeNull()
    expect(c.options.map(o => o.label)).toEqual(['Approve', 'Deny'])
    expect(c.detail!.tool).toBe('tool')
    expect(c.detail!.command).toMatch(/^print\(\d+\)\n[\s\S]*print\(60\)$/)
  })
  it('a dialog answered and gone is not read again (idle screen, Ask box)', () => {
    expect(parseOmpPrompt(fx('omp-idle-powerline.txt'))).toBeNull()
    expect(parseOmpPrompt(fx('omp-idle-footer.txt'))).toBeNull()
    expect(parseOmpPrompt(fx('omp-ask-single.txt'))!.question).toBe('Favourite colour?')
  })
})

describe('omp input field', () => {
  it('is seen when idle (both status line layouts), even with a draft', () => {
    expect(inputVisible(fx('omp-idle-powerline.txt'))).toBe(true)
    expect(inputVisible(fx('omp-idle-powerline.txt').replace(/╰─$/, '╰─ draft text'))).toBe(true)
    expect(inputVisible(fx('omp-idle-footer.txt'))).toBe(true)
  })
  it('is hidden by the approval dialog', () => {
    expect(inputVisible(fx('omp-approve-bash.txt'))).toBe(false)
    expect(inputVisible(fx('omp-approve-long.txt'))).toBe(false)
  })
})

describe('messages sent to omp during the dialog', () => {
  const approval = parseOmpPrompt(fx('omp-approve-bash.txt'))!
  it('go through the held prompt route, never typed + Enter into the dialog', () => {
    expect(viaPrompt({ agent: 'omp', status: 'blocked', prompt: approval })).toBe(true)
    expect(viaPrompt({ agent: 'omp', status: 'blocked', prompt: null })).toBe(true)
  })
  it('omp free-answer field still takes the typed answer', () => {
    const typing: Choices = { question: 'Favourite colour?', cursor: 0, options: [{ label: 'Other (type your own)', hint: null, free: true }], typing: true }
    expect(viaPrompt({ agent: 'omp', status: 'blocked', prompt: typing })).toBe(false)
  })
  it('Claude / Codex questions keep their typed answer', () => {
    expect(viaPrompt({ agent: 'claude', status: 'blocked', prompt: approval })).toBe(false)
    expect(viaPrompt({ agent: 'codex', status: 'blocked', prompt: null })).toBe(true)
    expect(viaPrompt({ agent: 'omp', status: 'idle', prompt: null })).toBe(true)
  })
  it('are held by the server while the input field is hidden', () => {
    expect(shouldHold('omp', 'idle', false, false)).toBe(true)
    expect(shouldHold('omp', 'idle', true, false)).toBe(false)
    expect(shouldHold('omp', 'blocked', true, true)).toBe(true)
  })
})

describe('pendingOmpTool', () => {
  const j = (o: unknown) => JSON.stringify(o)
  const assistant = (...calls: [string, string, unknown][]) => j({ type: 'message', message: { role: 'assistant', content: calls.map(([id, name, args]) => ({ type: 'toolCall', id, name, arguments: args, intent: `run ${name}` })) } })
  const start = (id: string, name: string) => j({ type: 'custom', customType: 'tool_execution_start', data: { toolCallId: id, toolName: name } })
  const result = (id: string) => j({ type: 'message', message: { role: 'toolResult', toolCallId: id } })

  it('full input of the started call with no result yet', () => {
    const code = Array.from({ length: 60 }, (_, i) => `print(${i + 1})`).join('\n')
    expect(pendingOmpTool([assistant(['a', 'eval', { language: 'py', code }]), start('a', 'eval')])).toEqual({ tool: 'eval', description: 'run eval', command: code })
  })
  it('skips answered calls, and picks the one named on screen among parallel calls', () => {
    const lines = [assistant(['a', 'bash', { i: 'x', command: 'ls' }], ['b', 'mcp_demo_search', { query: 'q' }]), start('a', 'bash'), start('b', 'mcp_demo_search')]
    expect(pendingOmpTool(lines, 'bash')).toEqual({ tool: 'bash', description: 'run bash', command: 'ls' })
    expect(pendingOmpTool(lines)!.command).toBe('{\n  "query": "q"\n}')
    expect(pendingOmpTool([...lines, result('a'), result('b')])).toBeNull()
  })
})
