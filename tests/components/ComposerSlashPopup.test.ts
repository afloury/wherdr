import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import Composer from '~/components/Composer.vue'
import { eventsOpen } from '~/composables/useHerdr'
import { menuState } from '~/composables/useUi'
import type { MenuItem } from '~/composables/useUi'
import type { Pane } from '#shared/types'
import type { SlashList } from '#shared/slashCommands'

let seq = 0
const pane = (agent: string): Pane => ({
  id: `w${++seq}:${agent}`, workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent, name: null, label: null, status: 'idle', title: null, cwd: '/home/user/acme-shop', agentSession: null,
})

const LIST: SlashList = {
  agent: 'omp',
  commands: [
    { name: 'compact', desc: 'Summarize the conversation', kind: 'command' },
    { name: 'context', desc: 'Show context usage', kind: 'command' },
    { name: 'skill:retro', desc: 'Run a retrospective on a coding session', kind: 'skill' },
    { name: 'skill:release-notes', desc: 'Draft release notes', kind: 'skill', hint: '[tag]' },
  ],
}
let reply: SlashList = LIST
let asked = 0
let prompts: string[] = []
registerEndpoint('/api/commands', { method: 'GET', handler: () => { asked++; return reply } })
registerEndpoint('/api/prompt', { method: 'POST', handler: async (event) => { prompts.push(String((await readBody(event)).text)); return { ok: true } } })

async function mount(agent: string) {
  const p = pane(agent)
  const w = await mountSuspended(Composer, { props: { pane: p, paneId: p.id, sendKeys: async () => {} } })
  const field = w.find('textarea')
  await field.trigger('focus')
  const value = () => (field.element as HTMLTextAreaElement).value
  const rows = () => w.findAll('[role="option"]').map(r => r.attributes('data-name'))
  const active = () => w.find('.slash-row.active').attributes('data-name')
  const list = () => w.find('[data-testid="slash-list"]')
  const press = (k: string) => field.trigger('keydown', { key: k })
  return { p, w, field, value, rows, active, list, press }
}

describe('Composer: "/" lists the agent’s commands and skills', () => {
  beforeEach(() => { eventsOpen.value = true; reply = LIST; asked = 0; prompts = [] })
  afterEach(() => { eventsOpen.value = false; menuState.open = false; menuState.items = [] })

  it('opens on "/", narrows as the word is typed, Tab completes the highlighted one', { timeout: 40000 }, async () => {
    const c = await mount('omp')
    await c.field.setValue('/')
    await vi.waitFor(() => expect(c.rows()).toEqual(['compact', 'context', 'skill:release-notes', 'skill:retro']))
    expect(asked).toBe(1)
    // A bare "/" browses: nothing is highlighted until a key or a pointer moves.
    expect(c.w.find('.slash-row.active').exists()).toBe(false)
    expect(c.w.find('[data-name="skill:release-notes"]').text()).toContain('[tag]')
    expect(c.w.find('[data-name="skill:retro"]').text()).toContain('skill')

    // "ret" is a word of skill:retro: found without knowing it is called that.
    await c.field.setValue('/ret')
    expect(c.rows()).toEqual(['skill:retro'])
    expect(c.active()).toBe('skill:retro')
    expect(c.field.attributes('aria-activedescendant')).toBe(c.w.find('.slash-row.active').attributes('id'))

    await c.press('Tab')
    expect(c.value()).toBe('/skill:retro ')
    expect(c.list().exists()).toBe(false)
    expect(prompts).toEqual([])
    expect(asked).toBe(1)
  })

  it('moves with the arrows and completes with Enter, which sends nothing', async () => {
    const c = await mount('claude')
    await c.field.setValue('/c')
    await vi.waitFor(() => expect(c.rows()).toEqual(['compact', 'context']))
    expect(c.active()).toBe('compact')
    await c.press('ArrowDown')
    expect(c.active()).toBe('context')
    await c.press('ArrowDown')
    expect(c.active()).toBe('compact')
    await c.press('ArrowUp')
    expect(c.active()).toBe('context')
    await c.press('Enter')
    expect(c.value()).toBe('/context ')
    expect(c.list().exists()).toBe(false)
    expect(prompts).toEqual([])
  })

  it('sends a command typed in full on Enter', async () => {
    const c = await mount('omp')
    await c.field.setValue('/compact')
    await vi.waitFor(() => expect(c.rows()).toEqual(['compact']))
    await c.press('Enter')
    await vi.waitFor(() => expect(prompts).toEqual(['/compact']))
  })

  it('closes on Escape and keeps what was typed', async () => {
    const c = await mount('omp')
    await c.field.setValue('/c')
    await vi.waitFor(() => expect(c.list().exists()).toBe(true))
    await c.press('Escape')
    expect(c.list().exists()).toBe(false)
    expect(c.value()).toBe('/c')
  })

  it('is picked by a tap, whose press keeps the keyboard in the field', async () => {
    const c = await mount('omp')
    await c.field.setValue('/')
    await vi.waitFor(() => expect(c.rows().length).toBe(4))
    const row = c.w.find('[data-name="skill:retro"]')
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    row.element.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    await row.trigger('click')
    expect(c.value()).toBe('/skill:retro ')
    expect(c.list().exists()).toBe(false)
    expect(prompts).toEqual([])
  })

  it('stays out of the way of a message that goes on and of the other agents', async () => {
    const c = await mount('omp')
    await c.field.setValue('/compact now')
    await c.field.setValue('/srv/app/x')
    expect(c.list().exists()).toBe(false)
    expect(asked).toBe(0)

    const other = await mount('codex')
    await other.field.setValue('/c')
    await other.field.setValue('/')
    expect(other.list().exists()).toBe(false)
    expect(asked).toBe(0)
  })

  it('shows what failed, with Try again', async () => {
    reply = { agent: 'omp', commands: [], error: 'unreachable' }
    const c = await mount('omp')
    await c.field.setValue('/')
    await vi.waitFor(() => expect(c.w.find('.slash-state.failed').exists()).toBe(true))
    reply = LIST
    await c.w.find('.slash-retry').trigger('click')
    await vi.waitFor(() => expect(c.rows().length).toBe(4))
    expect(asked).toBe(2)
  })

  it('has a way in from the + menu, for omp and Claude Code with an empty field', async () => {
    const c = await mount('claude')
    await c.w.find('[aria-label="Photo, file, paste, commands"]').trigger('click')
    const commands = menuState.items.filter((i: MenuItem) => i.kind === 'command')
    expect(commands.slice(0, 2).map(i => [i.cmd, i.desc])).toEqual([['esc', 'Interrupt agent'], ['/', 'Browse commands and skills']])
    commands[1]!.run?.()
    await vi.waitFor(() => expect(c.rows().length).toBe(4))
    expect(c.value()).toBe('/')

    // Not over a draft: the field keeps its text.
    menuState.items = []
    await c.field.setValue('a draft')
    await c.w.find('[aria-label="Photo, file, paste, commands"]').trigger('click')
    expect(menuState.items.some((i: MenuItem) => i.cmd === '/')).toBe(false)
  })
})
