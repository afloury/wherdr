// Ticking a task list of an agent's reply is passive: it is stored on the server
// (POST /api/checklist), sends nothing, and rides along with the user's next message.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import ChatMarkdown from '~/components/ChatMarkdown.vue'
import Composer from '~/components/Composer.vue'
import { eventsOpen } from '~/composables/useHerdr'
import { md } from '~/utils/markdown'
import { applySent, applyToggle } from '#shared/checklist'
import type { ChecklistState } from '#shared/checklist'
import type { Pane } from '#shared/types'

const AT = 1_700_000_000_000
const html = md('- [ ] Header\n- [x] Footer\n')

// The server: one state per pane, answers like the real routes.
const stored: Record<string, ChecklistState> = {}
const writes: Record<string, unknown>[] = []
const others: string[] = []
const prompts: string[] = []
registerEndpoint('/api/checklist', async (event) => {
    if (event.method === 'GET') return { state: stored[new URL(event.path, 'http://x').searchParams.get('pane_id') || ''] ?? {} }
    const body = await readBody<Record<string, any>>(event)
    writes.push(body)
    const state = stored[body.pane_id] ?? {}
    stored[body.pane_id] = body.op === 'toggle'
      ? applyToggle(state, body.key, { at: body.at, items: body.items }, body.index, body.checked)
      : applySent(state, body.marks)
    return { state: stored[body.pane_id] }
})
registerEndpoint('/api/prompt', { method: 'POST', handler: async (event) => { prompts.push((await readBody<{ text: string }>(event)).text); return { ok: true } } })
registerEndpoint('/api/input', { method: 'POST', handler: async () => { others.push('input'); return { ok: true } } })

const check = (pane: string) => ({ pane, key: 'm1', at: AT })
const boxes = (w: { findAll: (s: string) => any[] }) => w.findAll('input[type=checkbox]')

describe('Checklist ticks', () => {
  beforeEach(() => { writes.length = 0; others.length = 0; prompts.length = 0 })

  it('stores a tick on the server and sends nothing to the agent', async () => {
    const w = await mountSuspended(ChatMarkdown, { props: { html, typing: null, check: check('w1:tick') } })
    const [header, footer] = boxes(w)
    expect(header.element.disabled).toBe(false)
    await header.setValue(true)
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ pane_id: 'w1:tick', op: 'toggle', key: 'm1', at: AT, index: 0, checked: true })
    expect(footer.element.checked).toBe(true)
    expect(prompts).toEqual([])
    expect(others).toEqual([])
    w.unmount()
  })

  it('shows the stored ticks after a reload', async () => {
    stored['w1:reload'] = { m1: { at: AT, items: {
      0: { text: 'Header', written: false, checked: true, sent: false },
      1: { text: 'Footer', written: true, checked: false, sent: true },
    } } }
    const w = await mountSuspended(ChatMarkdown, { props: { html, typing: null, check: check('w1:reload') } })
    await vi.waitFor(() => expect(boxes(w).map(b => b.element.checked)).toEqual([true, false]))
    w.unmount()
  })

  // The items are the boxes on the page: a quoted list or code that looks like one shifts nothing.
  it('ticks the item whose box was ticked after a quoted list and indented code', async () => {
    const tricky = md('> - [ ] quoted\n\n    - [ ] in code\n\nPlan:\n\n- [ ] first\n- [ ] second\n')
    const w = await mountSuspended(ChatMarkdown, { props: { html: tricky, typing: null, check: check('w1:shift') } })
    const all = boxes(w)
    expect(all).toHaveLength(3)
    await all[2].setValue(true)
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ index: 2, items: [{ text: 'quoted' }, { text: 'first' }, { text: 'second' }] })
    expect(stored['w1:shift']!.m1!.items['2']).toMatchObject({ text: 'second', checked: true })
    w.unmount()
  })

  it('leaves the boxes read-only without a check prop', async () => {
    const w = await mountSuspended(ChatMarkdown, { props: { html, typing: null } })
    expect(boxes(w).every(b => b.element.disabled)).toBe(true)
    w.unmount()
  })
})

const pane = (id: string): Pane => ({ id, workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'pi', name: null, label: null, status: 'idle', title: null, cwd: '/home/user/demo', agentSession: null })
const ticked = (): ChecklistState => ({ m1: { at: AT, items: { 0: { text: 'Header', written: false, checked: true, sent: false } } } })

async function send(id: string, message: string, w?: Awaited<ReturnType<typeof mountSuspended>>) {
  const view = w ?? await mountSuspended(Composer, { props: { pane: pane(id), paneId: id, sendKeys: async () => {} } })
  await view.find('textarea').setValue(message)
  await view.find('button[type=submit], .prompt-send').trigger('click')
  await flushPromises()
  return view
}

describe('Composer + checklist', () => {
  beforeEach(() => { eventsOpen.value = true; prompts.length = 0; writes.length = 0 })
  afterEach(() => { eventsOpen.value = false })

  it('appends the ticks to the next message once, then nothing', async () => {
    stored['w1:next'] = ticked()
    const w = await mountSuspended(Composer, { props: { pane: pane('w1:next'), paneId: 'w1:next', sendKeys: async () => {} } })
    await vi.waitFor(() => expect(w.find('[data-testid=checklist-chip]').text()).toContain('1 ticked item will be sent'))
    await send('w1:next', 'Looks good', w)
    await vi.waitFor(() => expect(prompts).toHaveLength(1))
    expect(prompts[0]).toMatch(/^Looks good\n\nChecklist from your .+ message:\n\[x\] Header$/)
    await vi.waitFor(() => expect(writes.some(b => b.op === 'sent')).toBe(true))
    await vi.waitFor(() => expect(w.find('[data-testid=checklist-chip]').exists()).toBe(false))
    await send('w1:next', 'Thanks', w)
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(prompts[1]).toBe('Thanks')
    w.unmount()
  })

  it('counts only the user\'s ticks, not the agent\'s own', async () => {
    stored['w1:own'] = { m1: { at: AT, items: {
      0: { text: 'Header', written: true, checked: true, sent: true },
      1: { text: 'Body', written: false, checked: true, sent: false },
      2: { text: 'Footer', written: false, checked: true, sent: false },
    } } }
    const w = await mountSuspended(Composer, { props: { pane: pane('w1:own'), paneId: 'w1:own', sendKeys: async () => {} } })
    await vi.waitFor(() => expect(w.find('[data-testid=checklist-chip]').text()).toContain('2 ticked items will be sent'))
    await send('w1:own', 'Go on', w)
    await vi.waitFor(() => expect(prompts).toHaveLength(1))
    expect(prompts[0]).toMatch(/\n\[x\] Body\n\[x\] Footer$/)
    w.unmount()
  })

  it('appends nothing when nothing changed', async () => {
    await send('w1:none', 'Hello')
    await vi.waitFor(() => expect(prompts).toEqual(['Hello']))
  })

  it('appends nothing to a slash command', async () => {
    stored['w1:slash'] = ticked()
    const w = await mountSuspended(Composer, { props: { pane: pane('w1:slash'), paneId: 'w1:slash', sendKeys: async () => {} } })
    await vi.waitFor(() => expect(w.find('[data-testid=checklist-chip]').exists()).toBe(true))
    await send('w1:slash', '/compact', w)
    await vi.waitFor(() => expect(prompts.concat(others)).not.toEqual([]))
    expect(prompts.join('')).not.toContain('Checklist')
    expect(w.find('[data-testid=checklist-chip]').exists()).toBe(true)
    w.unmount()
  })

  it('discards the ticks from the chip without sending them', async () => {
    stored['w1:drop'] = ticked()
    const w = await mountSuspended(Composer, { props: { pane: pane('w1:drop'), paneId: 'w1:drop', sendKeys: async () => {} } })
    await vi.waitFor(() => expect(w.find('[data-testid=checklist-chip]').exists()).toBe(true))
    await w.find('[aria-label="Do not send the checklist"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid=checklist-chip]').exists()).toBe(false))
    expect(prompts).toEqual([])
    await send('w1:drop', 'Next', w)
    await vi.waitFor(() => expect(prompts).toEqual(['Next']))
    w.unmount()
  })
})
