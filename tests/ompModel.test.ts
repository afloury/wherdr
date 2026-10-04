// omp model switching: the "Switch Model" selector (alt+p, /switch, /model)
// captured in a real session (omp 18.4), the sequence that drives it, and the
// model read from its transcript (model_change, thinking_level_change,
// assistant message.model).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const j = (o: unknown) => JSON.stringify(o)

import {
  lastModel, learnOmpCycle, modelFromLine, ompEffortLevels, ompModelLabel, ompScreenEffort, ompSelectorCaption, parseOmpSelector,
} from '../server/utils/models'
import { createTranscripts, type Transcripts } from '../server/utils/transcripts'

describe('omp selector parsing', () => {
  it('reads the models, the cursor, the search and the current mark', () => {
    const s = parseOmpSelector(fx('omp-selector.txt'))!
    expect(s.options.map(o => o.label)).toEqual([
      'anthropic/claude-opus-5-5', 'anthropic/claude-haiku-4-5', 'anthropic/claude-sonnet-5-5',
      'anthropic/claude-sonnet-5', 'openrouter/z-ai/glm-5.3-flash', 'anthropic/claude-opus-5',
      'omlx/Qwen3.8-27B-8bit', 'opencode-zen/nemotron-3.5-lightning-free', 'nvidia/moonshotai/kimi-k3',
      'opencode-zen/nemotron-3-ultra-free',
    ])
    expect(s.cursor).toBe(0)
    expect(s.options[0]).toMatchObject({ current: true, hint: null })
    expect(s.options[1]).toMatchObject({ hint: 'context>200k' })
    expect(s.options[1]!.current).toBeFalsy()
    expect(s.options[6]).toMatchObject({ hint: 'context>262k' })
    expect(s.search).toBe('')
    expect(s.task).toBe(false)
  })

  it('reads the search field and the separator of a filtered list', () => {
    const s = parseOmpSelector(fx('omp-selector-search.txt'))!
    expect(s.search).toBe('glm')
    expect(s.separator).toBe(1)
    expect(s.options[0]!.label).toBe('openrouter/z-ai/glm-5.3-flash')
  })

  it('recognizes the Task-model variant and refuses other screens', () => {
    expect(parseOmpSelector(fx('omp-idle-footer.txt'))).toBeNull()
    expect(parseOmpSelector(fx('omp-ask-single.txt'))).toBeNull()
    expect(parseOmpSelector(fx('omp-models-panel.txt'))).toBeNull()
    // Task variant: same box, "Switch Task Model" title.
    const task = fx('omp-selector.txt').replace('╭─ Switch Model ', '╭─ Switch Task Model ')
      .replace('use for this session', 'use for Task subagents')
    expect(parseOmpSelector(task)?.task).toBe(true)
  })

  it('reads the caption omp itself gives, with the roles', () => {
    const t = fx('omp-selector.txt')
    expect(ompSelectorCaption(t, 'anthropic/claude-opus-5-5')).toEqual({
      name: 'Claude Opus 5.5',
      roles: ['current', 'default', 'slow', 'plan', 'designer'],
    })
    const s = parseOmpSelector(fx('omp-selector-search.txt'))!
    expect(ompSelectorCaption(fx('omp-selector-search.txt'), s.options[s.cursor].label)?.name).toBe('GLM 5.3 Flash')
    expect(ompSelectorCaption(t, 'anthropic/claude-sonnet-5-5')).toBeNull()
  })

  it('labels the ids readable (Claude ids with Claude\'s naming)', () => {
    expect(ompModelLabel('anthropic/claude-opus-5-5')).toBe('Opus 5.5')
    expect(ompModelLabel('anthropic/claude-haiku-4-5')).toBe('Haiku 4.5')
    expect(ompModelLabel('openrouter/z-ai/glm-5.3-flash')).toBe('Glm 5.3 flash')
    expect(ompModelLabel('web/exa')).toBe('exa')
    expect(ompModelLabel('omlx/Qwen3.8-27B-8bit')).toBe('Qwen 3.8 27B 8bit')
  })
})

describe('model in an omp transcript', () => {
  const modelChange = (model: string, role: string | undefined, ts: string) => j({
    type: 'model_change', id: 'x1', parentId: null, timestamp: ts, model, ...(role ? { role } : {}), resolvedModelIsFallback: false,
  })
  const level = (lvl: string, ts: string, configured: string | null = null) => j({
    type: 'thinking_level_change', id: 'x2', parentId: 'x1', timestamp: ts, thinkingLevel: lvl, configured,
  })
  const assistant = (model: string, ts: string) => j({
    type: 'message', timestamp: ts, message: { role: 'assistant', provider: 'anthropic', model, content: [{ type: 'text', text: 'ok' }] },
  })

  it('takes model_change (temporary switch) then merges the thinking level', () => {
    const lines = [modelChange('anthropic/claude-opus-5-5', 'temporary', 't1'), level('max', 't2')]
    expect(lastModel(lines, 'omp')).toEqual({ id: 'anthropic/claude-opus-5-5', label: 'Opus 5.5', effort: 'max', at: 't2' })
  })

  it('keeps the thinking level across later replies, the configured level ("auto") first', () => {
    const lines = [
      modelChange('anthropic/claude-opus-5-5', 'temporary', 't1'),
      level('medium', 't2', 'auto'),
      assistant('anthropic/claude-opus-5-5', 't3'),
    ]
    expect(lastModel(lines, 'omp')).toEqual({ id: 'anthropic/claude-opus-5-5', label: 'Opus 5.5', effort: 'auto', at: 't3' })
    // A later explicit choice (⇧⇥) wins, the model stays.
    expect(lastModel([...lines, level('high', 't4', 'high')], 'omp')).toMatchObject({ label: 'Opus 5.5', effort: 'high', at: 't4' })
  })

  it('the assistant message.model works alone (no thinking level)', () => {
    expect(lastModel([assistant('anthropic/claude-sonnet-5', 't1')], 'omp'))
      .toEqual({ id: 'anthropic/claude-sonnet-5', label: 'Sonnet 5', effort: null, at: 't1' })
  })

  it('a thinking_level_change without a model nearby is not enough', () => {
    expect(lastModel([level('xhigh', 't1')], 'omp')).toBeNull()
  })

  it('ignores other lines and quoted text', () => {
    expect(modelFromLine(j({ type: 'message', message: { role: 'user', content: 'écris {"type":"model_change"}' } }), 'omp')).toBeNull()
    expect(modelFromLine('plain text', 'omp')).toBeNull()
  })

  it('reads the real sessions of the test machine', () => {
    // Real capture: session-only switch then a thinking level, with replies before.
    const lines = [
      assistant('anthropic/claude-sonnet-5', '2026-09-21T02:21:04.000Z'),
      modelChange('anthropic/claude-opus-5-5', 'temporary', '2026-10-02T03:03:22.848Z'),
      level('max', '2026-10-02T03:03:22.849Z'),
    ]
    expect(lastModel(lines, 'omp')).toMatchObject({ id: 'anthropic/claude-opus-5-5', label: 'Opus 5.5', effort: 'max' })
  })
})

// The setModel sequence, on a fake Herdr socket (same harness as modelctlEffort).
const calls = vi.hoisted(() => ({ sent: [] as { method: string, params: Record<string, unknown> }[], screen: '', search: '', switched: false }))
vi.mock('../server/utils/env', () => ({ log: () => {}, HOME: '/home/x', DATA_DIR: '/tmp/x' }))
vi.mock('../server/utils/actions', () => ({ closePanel: async () => false }))
vi.mock('../server/utils/machines', () => ({ machineOfPane: () => null }))
vi.mock('../server/utils/herdr', () => {
  const herdr = async (method: string, params: Record<string, unknown>) => {
    calls.sent.push({ method, params })
    if (method === 'pane.read') return { read: { text: calls.screen } }
    if (method === 'pane.send_input') {
      const keys = (params.keys as string[]) || []
      if (keys.includes('alt+p')) calls.screen = fx('omp-selector.txt')
      // Letters go to the search field; only 'glm' matches something.
      if (keys.length === 1 && /^[a-z]$/.test(keys[0]!)) calls.search += keys[0]
      // "down" moves the cursor one row further; esc closes.
      if (keys.includes('down')) {
        const rows = calls.screen.split('\n')
        const at = rows.findIndex(l => l.startsWith('│ ❯'))
        if (at >= 0) {
          rows[at] = rows[at]!.replace(/^│ ❯ /, '│   ')
          rows[at + 1] = rows[at + 1]!.replace(/^│   /, '│ ❯ ')
          calls.screen = rows.join('\n')
        }
      }
      if (keys.includes('esc')) { calls.screen = ''; calls.search = '' }
      if (keys.includes('enter')) calls.switched = true
    }
    return {}
  }
  return {
    HerdrError: class HerdrError extends Error {
      constructor(public code: string, message: string) { super(message) }
    },
    sleep: async () => {},
    herdr,
    agentPrompt: async () => {},
  }
})
vi.mock('../server/utils/state', () => ({
  READY: new Set(['idle', 'done']),
  findPane: () => ({ id: 'w1:p1', agent: 'omp', status: 'idle' }),
  poll: () => {},
  transcripts: {
    model: async () => (calls.switched
      ? { id: 'openrouter/z-ai/glm-5.3-flash', label: 'Glm 5.3 flash', effort: null, at: new Date().toISOString() }
      : null),
  },
}))

import { setModel } from '../server/utils/modelctl'

describe('omp setModel sequence', () => {
  beforeEach(() => { calls.sent = []; calls.screen = '' })

  it('opens the selector with alt+p, moves the cursor, applies with Enter', async () => {
    const r = await setModel('w1:p1', 'openrouter/z-ai/glm-5.3-flash')
    expect(r).toMatchObject({ id: 'openrouter/z-ai/glm-5.3-flash' })
    expect(calls.sent.filter(c => c.method === 'pane.send_input').map(c => (c.params.keys as string[])[0]))
      .toEqual(['alt+p', 'down', 'down', 'down', 'down', 'enter'])
  })

  it('refuses an unknown model and closes the selector', async () => {
    await expect(setModel('w1:p1', 'nope/missing-model')).rejects.toMatchObject({ code: 'bad_model' })
    expect(calls.sent.filter(c => c.method === 'pane.send_input').map(c => (c.params.keys as string[])[0])).toContain('esc')
  })
})

describe('transcripts.model() for omp', () => {
  it('follows the transcript as it grows', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-omp-model-'))
    const dir = path.join(home, '.omp/agent/sessions/-x')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, '2026-10-02T03-02-29-192Z_test.jsonl')
    const mc = (model: string) => j({ type: 'model_change', id: 'm1', timestamp: '2026-10-02T03:03:22.848Z', model, role: 'temporary' }) + '\n'
    writeFileSync(file, j({ type: 'session', id: 'test', cwd: '/x' }) + '\n')
    const tr: Transcripts = createTranscripts({ home, herdr: async () => ({}) })
    const pane = { id: 'w1:p1', agent: 'omp', cwd: null, agentSession: file }
    expect(await tr.model(pane)).toBeNull()
    writeFileSync(file, readFileSync(file, 'utf8') + mc('anthropic/claude-opus-5-5'))
    expect((await tr.model(pane))?.label).toBe('Opus 5.5')
    // Only new bytes are read: the level then a reply keep both the model and the level.
    const add = (o: unknown) => writeFileSync(file, readFileSync(file, 'utf8') + j(o) + '\n')
    add({ type: 'thinking_level_change', timestamp: '2026-10-02T03:03:23.000Z', thinkingLevel: 'medium', configured: 'auto' })
    add({ type: 'message', timestamp: '2026-10-02T03:04:00.000Z', message: { role: 'assistant', model: 'claude-opus-5-5', content: [] } })
    expect(await tr.model(pane)).toMatchObject({ label: 'Opus 5.5', effort: 'auto' })
    add({ type: 'thinking_level_change', timestamp: '2026-10-02T03:05:00.000Z', thinkingLevel: 'xhigh', configured: 'xhigh' })
    expect(await tr.model(pane)).toMatchObject({ label: 'Opus 5.5', effort: 'xhigh' })
    // A fresh reader (service restart) finds the level behind the last reply.
    add({ type: 'message', timestamp: '2026-10-02T03:06:00.000Z', message: { role: 'assistant', model: 'claude-opus-5-5', content: [] } })
    expect(await createTranscripts({ home, herdr: async () => ({}) }).model(pane)).toMatchObject({ label: 'Opus 5.5', effort: 'xhigh' })
  })
})

describe('omp thinking level on screen', () => {
  it('reads the compact glyph before the model name, in both status line layouts', () => {
    expect(ompScreenEffort(fx('omp-done.txt'), 'Opus 5.5')).toBe('low')
    expect(ompScreenEffort(fx('omp-idle-footer.txt'), 'Opus 5.5')).toBe('high')
    expect(ompScreenEffort(' π > ⟳ Opus 5.5 > 🗑 ~/demo > ▶─1%────', 'Opus 5.5')).toBe('auto')
    expect(ompScreenEffort(' π > ⦸ Opus 5.5 > 🗑 ~/demo > ▶─1%────', 'Opus 5.5')).toBe('off')
    expect(ompScreenEffort(' π > [xhi] Opus 5.5 > ~/demo ────', 'Opus 5.5')).toBe('xhigh')
  })

  it('reads the " · level" suffix when the compact display is off', () => {
    expect(ompScreenEffort(' π > ⬡ Opus 5.5 · ◑ med > 🗑 ~/demo ────', 'Opus 5.5')).toBe('medium')
    expect(ompScreenEffort(' π > ⬡ Opus 5.5 · [ ] off > ~/demo ────', 'Opus 5.5')).toBe('off')
  })

  it('needs the model name next to the glyph: no guess from the conversation or a selector', () => {
    expect(ompScreenEffort(' ◉ done, see above\n π > ⬡ Opus 5.5 > 🗑 ~/demo ────', 'Opus 5.5')).toBeNull()
    expect(ompScreenEffort(fx('omp-done.txt'), 'Sonnet 5')).toBeNull()
    expect(ompScreenEffort(fx('omp-selector.txt'), 'Opus 5.5')).toBeNull()
  })
})

describe('omp ⇧⇥ cycle knowledge', () => {
  it('offers the common levels until presses show the model\'s own', () => {
    expect(ompEffortLevels(null)).toEqual(['off', 'auto', 'low', 'medium', 'high', 'xhigh', 'max'])
    // high → off skips xhigh and max; auto → minimal shows an extra level.
    const known = learnOmpCycle(null, ['high', 'off', 'auto', 'minimal'])
    expect(ompEffortLevels(known)).toEqual(['off', 'auto', 'minimal', 'low', 'medium', 'high'])
    // A later press that shows a level again restores it.
    expect(ompEffortLevels(learnOmpCycle(known, ['high', 'xhigh']))).toContain('xhigh')
  })
})
