import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCorePreviews, lastLine } from '../server/utils/corePreview'
import type { Pane } from '../shared/types'

const pane = (id: string, extra: Partial<Pane> = {}) => ({ id, workspace: 'w', coreAddress: `m/${id}`, agent: null, status: 'idle', ...extra }) as Pane
const settle = () => new Promise(r => setTimeout(r, 5))

describe('lastLine', () => {
  it('skips Claude\'s duration line and shows the last answer', () => {
    const screen = readFileSync(new URL('./fixtures/claude-done-time.txt', import.meta.url), 'utf8')
    expect(lastLine(screen)).toBe('Hello, all good.')
    expect(lastLine('* Compiled for 3s ok')).toBe('* Compiled for 3s ok')
    expect(lastLine(readFileSync(new URL('./fixtures/claude-done.txt', import.meta.url), 'utf8'))).toBe("C'est fait : 12 tests verts.")
  })

  it('skips prompts, rules and blanks', () => {
    expect(lastLine('build ok\n\nuser@host:~/dir$ \n')).toBe('build ok')
    expect(lastLine('The build passes.\n────────\n❯\n')).toBe('The build passes.')
    expect(lastLine('user@host:~$')).toBeNull()
  })
  it('ignores drawings: braille logos and block elements', () => {
    expect(lastLine('⠈⠙⠛⠿⠿⠿⠿⠛⠉\n')).toBeNull()
    expect(lastLine('Ready to go\n  ⠈⠙⠛⠿⠿⠿⠿⠛⠉  \n ▀▀▀ ▄▄ \n')).toBe('Ready to go')
    expect(lastLine('Build ⠿ 3 files')).toBe('Build ⠿ 3 files')
  })
  it('ignores TUI footers', () => {
    expect(lastLine('Welcome back\n────\n❯\n────\n  ← for agents · ? for shortcuts')).toBe('Welcome back')
    expect(lastLine('Done\n  ⏵⏵ auto mode on (shift+tab to cycle)')).toBe('Done')
    expect(lastLine('Done\n  auto mode on (shift+tab to cycle)')).toBe('Done')
    expect(lastLine('Done\n  ? for shortcuts')).toBe('Done')
    expect(lastLine('Quick check\n Enter to confirm · Esc to cancel')).toBe('Quick check')
    expect(lastLine('← for agents · ? for shortcuts')).toBeNull()
    expect(lastLine('The shortcuts are listed below')).toBe('The shortcuts are listed below')
    expect(lastLine('x'.repeat(300))!.length).toBe(200)
  })
})

describe('core previews', () => {
  it('reads once per state, prefers the agent reply, falls back to the terminal line', async () => {
    const reads: string[] = []
    const p = createCorePreviews({ reply: async x => (x.agent ? { text: 'All done.' } : null), read: async a => { reads.push(a); return 'line one\nlast line\n' } })
    const panes = () => [pane('t1', { agent: 'claude', stateSeq: 1 }), pane('t2', { stateSeq: 1 })]
    let list = panes()
    p.apply(list)
    expect(list.map(x => x.preview)).toEqual([undefined, undefined])
    await settle()
    list = panes()
    p.apply(list)
    expect(list.map(x => x.preview)).toEqual(['All done.', 'last line'])
    await settle()
    expect(reads).toEqual(['m/t2'])
    // same state: nothing read again; a new status_ms: read again, old text kept meanwhile
    p.apply(panes())
    await settle()
    expect(reads).toHaveLength(1)
    list = [pane('t2', { stateSeq: 2 })]
    p.apply(list)
    expect(list[0]!.preview).toBe('last line')
    await settle()
    expect(reads).toHaveLength(2)
  })
  it('limits the readings in flight and forgets gone panes', async () => {
    let active = 0, peak = 0
    const p = createCorePreviews({ reply: async () => null, read: async () => { peak = Math.max(peak, ++active); await settle(); active--; return 'x' } })
    p.apply(Array.from({ length: 10 }, (_, i) => pane(`t${i}`)))
    await settle()
    expect(peak).toBe(4)
    p.apply([])
  })
})
