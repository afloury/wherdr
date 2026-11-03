// A menu left open on the agent's screen (Claude's /status opened in its
// terminal during a turn) hides the input field held messages wait for: the
// conversation says so.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lookForLeftMenu } from '../server/utils/queued'
import { inputVisible } from '../server/utils/choices'
import type { Pane, QueuedMessage } from '../shared/types'

const pane = (more: Partial<Pane> = {}): Pane => ({ id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'working', title: null, cwd: '/tmp/demo', agentSession: null, ...more })
const held = (more: Partial<QueuedMessage> = {}): QueuedMessage => ({ id: 'a', text: 'hello', at: 1, state: 'held', ...more })

describe('lookForLeftMenu', () => {
  it('looks while messages wait for the input field and no card explains why', () => {
    expect(lookForLeftMenu(pane({ queued: [held({ reason: 'turn' })] }))).toBe(true)
    expect(lookForLeftMenu(pane({ status: 'idle', queued: [held()] }))).toBe(true)
    expect(lookForLeftMenu(pane({ status: 'done', queued: [held({ state: 'failed', reason: 'no_input' })] }))).toBe(true)
  })
  it('does not look when nothing waits for the field, or when a card already shows the screen', () => {
    expect(lookForLeftMenu(pane())).toBe(false)
    expect(lookForLeftMenu(pane({ queued: [{ id: 'a', text: 'hello' }] }))).toBe(false)
    expect(lookForLeftMenu(pane({ queued: [held({ reason: 'busy' })] }))).toBe(false)
    expect(lookForLeftMenu(pane({ queued: [held({ state: 'failed' })] }))).toBe(false)
    expect(lookForLeftMenu(pane({ status: 'idle', queued: [held()], menu: { title: 'Resume', lines: [], items: [], cursor: null, search: null, actions: [], more: null } }))).toBe(false)
    expect(lookForLeftMenu(pane({ status: 'blocked', queued: [held()] }))).toBe(false)
    expect(lookForLeftMenu(pane({ agent: 'gemini', queued: [held()] }))).toBe(false)
    expect(lookForLeftMenu(pane({ stopped: { reason: 'update' }, queued: [held()] }))).toBe(false)
  })
})

// Claude's screen during a turn, with and without /status drawn over its field.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8')
const STATUS = fixture('claude-settings-status')
const FIELD = fixture('claude-working')

describe('a menu left open', () => {
  it('reads /status as hiding the field, and a working screen as showing it', () => {
    expect(inputVisible(STATUS)).toBe(false)
    expect(inputVisible(FIELD)).toBe(true)
  })
})
