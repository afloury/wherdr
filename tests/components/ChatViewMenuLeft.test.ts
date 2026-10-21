// A menu left open in the agent's terminal (Claude's /status during a turn)
// holds messages back with no card in the conversation: a notice says so and
// offers to close it or to send anyway.
import { afterEach, describe, expect, it } from 'vitest'
import { readBody } from 'h3'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ChatView from '~/components/ChatView.vue'
import { herdrState } from '~/composables/useHerdr'
import type { Pane } from '#shared/types'

let available = true
registerEndpoint('/api/chat', () => ({ available, reason: available ? undefined : 'not_found', token: 'menu-left', file: '/tmp/demo/transcript.jsonl', items: [{ role: 'user', text: 'Write the release notes.', ts: '2026-01-01T00:00:00Z' }] }))
const calls: unknown[] = []
registerEndpoint('/api/menu-left', { method: 'POST', handler: async (event) => { calls.push(await readBody(event)); return { ok: true, closed: true, sent: 1 } } })

const base: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'working', title: null, cwd: '/tmp/demo', agentSession: null }
const queued = [{ id: 'm1', text: 'Also update the changelog.', at: Date.now(), state: 'held' as const, reason: 'turn' as const }]

async function mount(pane: Pane) {
  herdrState.value = { ok: true, workspaces: [], panes: [pane] }
  const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
  await expect.poll(() => w.find('.chat').text()).toContain('Also update the changelog.')
  return w
}

describe('menu left open in the terminal', () => {
  afterEach(() => { available = true; calls.length = 0; herdrState.value = { ok: false, workspaces: [], panes: [] } })

  it('says the menu is still open and closes it, or sends anyway', async () => {
    const w = await mount({ ...base, queued, menuLeftOpen: true })
    try {
      const notice = w.find('.menu-left')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain('A menu is still open in the agent’s terminal')
      const [close, send] = notice.findAll('button')
      expect(close!.text()).toBe('Close menu')
      expect(send!.text()).toBe('Send anyway')
      await close!.trigger('click')
      await expect.poll(() => calls.length).toBe(1)
      await expect.poll(() => (send!.element as HTMLButtonElement).disabled).toBe(false)
      await send!.trigger('click')
      await expect.poll(() => calls.length).toBe(2)
      expect(calls).toEqual([{ pane_id: 'w1:p1', action: 'close' }, { pane_id: 'w1:p1', action: 'send' }])
    } finally { w.unmount() }
  })

  it('says nothing when no menu hides the field', async () => {
    const w = await mount({ ...base, queued })
    try {
      expect(w.find('.menu-left').exists()).toBe(false)
    } finally { w.unmount() }
  })

  it('leaves the waiting explanation to the open menu on a blocked agent', async () => {
    const w = await mount({ ...base, status: 'blocked', queued, menu: {
      title: 'Hooks', items: [], lines: [], actions: [{ key: 'esc', label: 'cancel' }],
      cursor: null, search: null, more: null,
    } })
    try {
      expect(w.find('.chat-status.waiting').exists()).toBe(false)
      expect(w.find('.chat-empty.waiting').exists()).toBe(false)
      // An unrecognized blocked screen still needs its terminal hint.
      await w.setProps({ pane: { ...base, status: 'blocked', queued } })
      expect(w.find('.chat-status.waiting').text()).toContain('Waiting for your reply')
    } finally { w.unmount() }
  })


  it('shows only one waiting hint when a transcript is not available yet', async () => {
    available = false
    const w = await mount({ ...base, id: 'w1:p2', status: 'blocked', queued, screen: {
      kind: 'other', title: null, lines: ['Waiting for input'], actions: [],
    } })
    try {
      await expect.poll(() => w.find('.chat-empty.waiting').exists()).toBe(true)
      expect(w.find('.chat-status.waiting').exists()).toBe(false)
    } finally { w.unmount() }
  })

})
