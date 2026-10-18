import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import { UApp } from '#components'
import type { Pane } from '#shared/types'
import TaskText from '~/components/TaskText.vue'
import { desk, eventsOpen, herdrState } from '~/composables/useHerdr'
import { answerConfirm, confirmState, menuState } from '~/composables/useUi'

// Messages as the server receives them.
const posts: string[] = []
for (const route of ['/api/prompt', '/api/input']) {
  registerEndpoint(route, {
    method: 'POST',
    handler: async (event) => {
      posts.push(String((await readBody<{ text?: string }>(event))?.text ?? ''))
      return { ok: true }
    },
  })
}

const pane = (over: Partial<Pane> = {}): Pane => ({
  id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null,
  status: 'idle', title: null, cwd: null, agentSession: null, ...over,
})
const mount = (text: string, paneId = 'w1:p1') => mountSuspended(defineComponent({
  render: () => h(UApp, null, () => h('span', { class: 'pp-task-text' }, [h(TaskText, { text, paneId })])),
}))
const labels = () => menuState.items.map(i => i.label)

describe('TaskText inline code', () => {
  const before = herdrState.value
  beforeEach(() => {
    posts.length = 0
    menuState.open = false
    menuState.items = []
    desk.value = false // a phone: the menu is a sheet
    eventsOpen.value = true
    herdrState.value = { ok: true, workspaces: [], panes: [pane()] }
  })
  afterEach(() => {
    herdrState.value = before
    eventsOpen.value = false
    if (confirmState.open) answerConfirm(false)
  })

  it('renders code spans as code, tinted by kind, between links and text', async () => {
    const w = await mount('Run `npm test` on `app/x.ts`, see https://example.test/a')
    const codes = w.findAll('code.pp-code')
    expect(codes.map(c => c.text())).toEqual(['npm test', 'app/x.ts'])
    expect(codes.map(c => c.attributes('data-k'))).toEqual(['cmd', 'path'])
    expect(codes[0]!.attributes('role')).toBe('button')
    expect(w.get('a.pp-tlink').attributes('href')).toBe('https://example.test/a')
    expect(w.text()).toBe('Run npm test on app/x.ts, see https://example.test/a')
  })

  it('a command: Run… then Copy; Run asks first, then sends it in shell mode', async () => {
    const w = await mount('Check with `npm run check:leaks`')
    await w.get('code.pp-code').trigger('click')
    expect(menuState.open).toBe(true)
    expect(labels()).toEqual([tl('Run…', 'Lancer…'), t('Copy command')])
    menuState.items[0]!.run!()
    await flushPromises()
    expect(confirmState.open).toBe(true)
    expect(confirmState.code).toBe('npm run check:leaks')
    expect(posts).toEqual([])
    answerConfirm(true)
    await flushPromises()
    expect(posts).toEqual(['! npm run check:leaks'])
  })

  it('a prompt written before the command is not sent nor copied', async () => {
    const w = await mount('Then `! gh pr merge 5`')
    await w.get('code.pp-code').trigger('click')
    expect(menuState.items.map(i => i.desc)).toEqual([undefined, 'gh pr merge 5'])
  })

  it('cancelling the confirmation sends nothing', async () => {
    const w = await mount('`npm test`')
    await w.get('code.pp-code').trigger('click')
    menuState.items[0]!.run!()
    await flushPromises()
    answerConfirm(false)
    await flushPromises()
    expect(posts).toEqual([])
  })

  it('code that is not a command, or no agent to run it: Copy only', async () => {
    let w = await mount('Rename `fooBar` and `app/x.ts`')
    await w.findAll('code.pp-code')[0]!.trigger('click')
    expect(labels()).toEqual([t('Copy')])
    await w.findAll('code.pp-code')[1]!.trigger('click')
    expect(labels()).toEqual([t('Copy path')])

    // A shell pane, offline, or no pane given: a command can only be copied.
    herdrState.value = { ok: true, workspaces: [], panes: [pane({ agent: null })] }
    w = await mount('`npm test`')
    await w.get('code.pp-code').trigger('click')
    expect(labels()).toEqual([t('Copy command')])
    herdrState.value = { ok: true, workspaces: [], panes: [pane()] }
    eventsOpen.value = false
    await w.get('code.pp-code').trigger('click')
    expect(labels()).toEqual([t('Copy command')])
  })

  it('an agent waiting on a question is not sent the command', async () => {
    herdrState.value = { ok: true, workspaces: [], panes: [pane({ status: 'blocked', prompt: { question: 'Allow?', cursor: 0, options: [{ label: 'Yes' }] } as Pane['prompt'] })] }
    const w = await mount('`npm test`')
    await w.get('code.pp-code').trigger('click')
    menuState.items[0]!.run!()
    await flushPromises()
    expect(confirmState.open).toBe(false)
    expect(posts).toEqual([])
  })

  it('the keyboard opens the menu too, and a tap does not reach the row', async () => {
    let rowClicks = 0
    const w = await mountSuspended(defineComponent({
      render: () => h(UApp, null, () => h('span', { onClick: () => { rowClicks++ } }, [h(TaskText, { text: '`npm test`', paneId: 'w1:p1' })])),
    }))
    await w.get('code.pp-code').trigger('keydown', { key: 'Enter' })
    expect(menuState.open).toBe(true)
    await w.get('code.pp-code').trigger('click')
    expect(rowClicks).toBe(0)
  })
})
