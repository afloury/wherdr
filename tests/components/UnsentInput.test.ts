// herdr-core, Claude: text left unsent in Claude's input box shows in the
// conversation as "Not sent" with Send now / Clear; Claude's queue gets Send now.
import { afterEach, describe, expect, it } from 'vitest'
import { readBody } from 'h3'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ChatView from '~/components/ChatView.vue'
import { herdrState } from '~/composables/useHerdr'
import type { Pane } from '#shared/types'

registerEndpoint('/api/chat', () => ({ available: true, token: 'unsent', file: '/tmp/demo/transcript.jsonl', items: [{ role: 'user', text: 'Write the release notes.', ts: '2026-01-01T00:00:00Z' }] }))
const calls: Record<string, unknown>[] = []
let started = true
registerEndpoint('/api/draft', { method: 'POST', handler: async (event) => { calls.push(await readBody(event)); return { ok: true, started } } })

const base: Pane = { id: 'core:t2', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null, coreAddress: 'local/t2' }

async function mount(pane: Pane) {
  herdrState.value = { ok: true, workspaces: [], panes: [pane] }
  const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
  await expect.poll(() => w.find('.chat').text()).toContain('Write the release notes.')
  return w
}

describe('text left unsent in Claude’s input', () => {
  afterEach(() => { calls.length = 0; started = true; herdrState.value = { ok: false, workspaces: [], panes: [] } })

  it('shows the text as not sent, and sends or clears it', async () => {
    const w = await mount({ ...base, draft: { text: 'Summarise the README.\nKeep it short.', lines: 2 } })
    try {
      const box = w.find('[data-testid="unsent-input"]')
      expect(box.text()).toContain('Summarise the README.')
      expect(box.find('.unsent-text').text()).toBe('Summarise the README.\nKeep it short.')
      expect(box.text()).toContain('Not sent — still in Claude’s input')
      const [send, clear] = box.findAll('button')
      expect(send!.text()).toContain('Send now')
      expect(clear!.text()).toContain('Clear')
      await send!.trigger('click')
      await expect.poll(() => calls.length).toBe(1)
      await clear!.trigger('click')
      await expect.poll(() => calls.length).toBe(2)
      expect(calls).toEqual([
        { pane_id: 'core:t2', action: 'send', text: 'Summarise the README.\nKeep it short.' },
        { pane_id: 'core:t2', action: 'clear', text: 'Summarise the README.\nKeep it short.' },
      ])
    } finally { w.unmount() }
  })

  it('Send now for Claude’s queue', async () => {
    const w = await mount({ ...base, status: 'working', queueSendNow: true })
    try {
      expect(w.find('[data-testid="unsent-input"]').exists()).toBe(false)
      await w.find('[data-testid="queue-send-now"]').trigger('click')
      await expect.poll(() => calls).toEqual([{ pane_id: 'core:t2', action: 'send-queued' }])
    } finally { w.unmount() }
  })

  it('nothing without a draft', async () => {
    const w = await mount(base)
    try {
      expect(w.find('[data-testid="unsent-input"]').exists()).toBe(false)
      expect(w.find('[data-testid="queue-send-now"]').exists()).toBe(false)
    } finally { w.unmount() }
  })
})
