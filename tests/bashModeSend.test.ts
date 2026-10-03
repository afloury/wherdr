// "! cmd" sent to Claude Code: the "!" switches its input field to bash mode
// ("!" prompt, pink rules, "! for shell mode" below) and only "cmd" stays in
// the field. Screens captured on Claude Code 2.1.288 (command renamed).
// Before the fix, the guarded send did not find the field any more, held the
// message as "will be sent when the menu closes" and never pressed Enter.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type GuardDeps, guardedSend } from '../server/utils/guardedSend'
import { inputBox } from '../server/utils/unqueue'
import { inputVisible, panelOpen, parseChoices } from '../server/utils/choices'
import { parseWaitScreen } from '../server/utils/waitScreen'
import { parseMenu } from '../shared/menuScreen'
import { NO_INPUT_MS, type QueueEntry, checkQueue, publicEntry } from '../server/utils/queued'

const fx = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
const ESC = String.fromCharCode(27)
const PINK = `${ESC}[0m${ESC}[38;2;253;93;177m`
const GRAY = `${ESC}[0m${ESC}[38;2;136;136;136m`
const RULE = '─'.repeat(60)
const plain = (ansi: string) => ansi.replace(new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g'), '').replace(/\r/g, '')

// Bottom of Claude's screen for a field: bash mode when it was entered with a
// "!" typed into the empty field (as Claude does).
function screen(field: { bash: boolean, text: string }): string {
  if (field.bash) return [`${PINK}${RULE}${ESC}[0m`, `${PINK}! ${ESC}[0m${field.text}`, `${PINK}${RULE}${ESC}[0m`, `  ${PINK}! for shell mode${ESC}[0m`].join('\r\n')
  return [`${GRAY}${RULE}${ESC}[0m`, `❯ ${field.text}`, `${GRAY}${RULE}${ESC}[0m`, '  ⏵⏵ auto mode on'].join('\r\n')
}

describe('Claude bash mode input field', () => {
  it('reads the field as the typed message, "!" first', () => {
    expect(inputBox(fx('claude-bash-mode.ansi'))).toBe('! make demo-build')
    expect(inputBox(fx('claude-bash-mode-empty.ansi'))).toBe('!')
    expect(inputBox(screen({ bash: true, text: ' git status' }))).toBe('! git status')
  })

  it('does not take a past "!" command in the conversation for the field', () => {
    // History lines use a normal space and no rule above.
    expect(inputBox(`${PINK}! ${ESC}[0m echo old\r\n\r\n${screen({ bash: false, text: '' })}`)).toBe('')
    expect(inputBox(`${PINK}! ${ESC}[0m echo old\r\n`)).toBeNull()
  })

  it('is the input field, not a menu or a panel, typed in or left empty', () => {
    for (const text of [fx('claude-bash-mode.txt'), plain(fx('claude-bash-mode-empty.ansi'))]) {
      expect(inputVisible(text)).toBe(true)
      expect(panelOpen(text, 'claude')).toBe(false)
      expect(parseChoices(text)).toBeNull()
      expect(parseWaitScreen(text)).toBeNull()
    }
    expect(parseMenu(fx('claude-bash-mode-empty.ansi'))).toBeNull()
  })

  it('the "#" prefix is plain text in the normal field', () => {
    expect(inputBox(screen({ bash: false, text: '# remember this' }))).toBe('# remember this')
  })
})

// Fake Claude field driven through the real screen parser.
// `stayBash`: Claude stays in bash mode after running a command; `stuck`:
// Backspace does not leave bash mode.
function claude(o: { bash?: boolean, text?: string, stayBash?: boolean, stuck?: boolean } = {}) {
  const f = { bash: o.bash ?? false, text: o.text ?? '', submitted: [] as string[], keys: [] as string[], typed: [] as string[], clock: 0 }
  const deps: GuardDeps = {
    box: async () => { f.clock += 20; return inputBox(screen(f)) },
    type: async (t) => {
      f.typed.push(t)
      if (!f.bash && !f.text && t.startsWith('!')) { f.bash = true; t = t.slice(1) }
      f.text += t
    },
    keys: async (keys) => {
      for (const k of keys) {
        f.keys.push(k)
        if (k === 'ctrl+u') f.text = ''
        if (k === 'backspace') { if (f.text) f.text = f.text.slice(0, -1); else if (!o.stuck) f.bash = false }
        if (k === 'enter' && f.text.trim()) {
          f.submitted.push(f.bash ? `!${f.text}` : f.text)
          f.text = ''
          f.bash = f.bash && Boolean(o.stayBash)
        }
      }
    },
    sleep: async (ms) => { f.clock += ms },
    now: () => f.clock,
    sentSince: async () => [...f.submitted],
  }
  return { f, deps }
}
const fast = { freeWaitMs: 500, quietMs: 0, showWaitMs: 500, submitWaitMs: 600, pollMs: 100 }

describe('guarded send of a "!" command', () => {
  it('types it, recognizes bash mode and presses Enter', async () => {
    const { f, deps } = claude()
    const r = await guardedSend(deps, '! make demo-build', fast)
    expect(f.submitted).toEqual(['! make demo-build'])
    expect(f.keys).toEqual(['enter'])
    expect(r).toEqual({ foreign: [], unsent: [] })
  })

  it('works without a space after "!"', async () => {
    const { f, deps } = claude()
    await guardedSend(deps, '!ls -la', fast)
    expect(f.submitted).toEqual(['!ls -la'])
  })

  it('empty bash mode: a normal message leaves it with Backspace first', async () => {
    // Typed there, it would run as a shell command.
    const { f, deps } = claude({ bash: true })
    await guardedSend(deps, 'Why is the build slow?', fast)
    expect(f.keys).toEqual(['backspace', 'enter'])
    expect(f.submitted).toEqual(['Why is the build slow?'])
  })

  it('empty bash mode: a "!" message is typed without its "!"', async () => {
    const { f, deps } = claude({ bash: true })
    await guardedSend(deps, '! make demo-build', fast)
    expect(f.typed).toEqual([' make demo-build'])
    expect(f.keys).toEqual(['enter'])
    expect(f.submitted).toEqual(['! make demo-build'])
  })

  it('Claude left in bash mode after a command: the next message still goes out', async () => {
    const { f, deps } = claude({ stayBash: true })
    await guardedSend(deps, '! make demo-build', fast)
    expect(f.bash).toBe(true)
    await guardedSend(deps, 'and now?', fast)
    expect(f.submitted).toEqual(['! make demo-build', 'and now?'])
  })

  it('bash mode that cannot be left: reported, nothing typed', async () => {
    const { f, deps } = claude({ bash: true, stuck: true })
    await expect(guardedSend(deps, 'hello', fast)).rejects.toMatchObject({ code: 'bash_mode' })
    expect(f.typed).toEqual([])
  })

  it('a bash-mode draft typed in the terminal is never cleared', async () => {
    const { f, deps } = claude({ bash: true, text: ' rm -i old.log' })
    await expect(guardedSend(deps, 'hello', fast)).rejects.toMatchObject({ code: 'input_busy' })
    expect(f.keys).toEqual([])
  })

  it('a normal message still goes through', async () => {
    const { f, deps } = claude()
    await guardedSend(deps, 'hello there', fast)
    expect(f.submitted).toEqual(['hello there'])
  })
})

describe('held message with no menu to wait for', () => {
  const held = (): QueueEntry => ({ id: 'a', text: 'hello', at: 0, held: true })

  it('agent ready, no menu recognized: not sent after a short delay, with the reason', () => {
    const list = [held()]
    expect(checkQueue(list, 'idle', 1000, false)).toBe(false)
    expect(checkQueue(list, 'idle', 1000 + NO_INPUT_MS - 1, false)).toBe(false)
    expect(checkQueue(list, 'idle', 1000 + NO_INPUT_MS + 1, false)).toBe(true)
    expect(publicEntry(list[0]!)).toMatchObject({ state: 'failed', reason: 'no_input' })
  })

  it('a recognized menu, a turn or a busy field keep it waiting', () => {
    const t = NO_INPUT_MS * 2
    const menu = [held()]
    checkQueue(menu, 'idle', 1000, true)
    expect(checkQueue(menu, 'idle', 1000 + t, true)).toBe(false)
    const working = [held()]
    checkQueue(working, 'working', 1000, false)
    expect(checkQueue(working, 'working', 1000 + t, false)).toBe(false)
    const busy = [{ ...held(), busy: true }]
    checkQueue(busy, 'idle', 1000, false)
    expect(checkQueue(busy, 'idle', 1000 + NO_INPUT_MS + 1, false)).toBe(false)
  })

  it('the delay restarts when a menu shows up meanwhile', () => {
    const list = [held()]
    checkQueue(list, 'idle', 1000, false)
    checkQueue(list, 'idle', 1000 + NO_INPUT_MS / 2, true)
    expect(checkQueue(list, 'idle', 1000 + NO_INPUT_MS + 1, false)).toBe(false)
    expect(list[0]!.failed).toBeFalsy()
  })
})
