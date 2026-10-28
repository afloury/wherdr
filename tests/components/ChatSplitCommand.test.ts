import { afterEach, describe, expect, it } from 'vitest'
import { readBody } from 'h3'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ChatView from '~/components/ChatView.vue'
import { desk, herdrState } from '~/composables/useHerdr'
import { menuState } from '~/composables/useUi'
import type { Pane } from '#shared/types'

const pane: Pane = { id: 'ab12~w1:p1', machine: 'ab12', workspace: 'ab12~w1', tab: 'ab12~w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'working', title: null, cwd: '/project', agentSession: null }
const calls: unknown[] = []
let created = false
registerEndpoint('/api/chat', () => ({ available: true, token: 'split-command', file: '/project/chat.jsonl', items: [{ role: 'assistant', text: 'Try `! gcloud auth login`.', ts: null }] }))
registerEndpoint('/api/split-command', { method: 'POST', handler: async event => {
  calls.push(await readBody(event))
  return { ok: true, pane_id: 'ab12~w1:p2', created }
} })

describe('chat command split terminal menu', () => {
  afterEach(() => { calls.length = 0; menuState.open = false; menuState.items = []; herdrState.value = { ok: false, workspaces: [], panes: [] } })

  it.each(['free', 'busy', 'missing', 'manual'])('sends the explicit split action for a %s sibling shell', async mode => {
    // Shell selection and readiness belong to the server; the component must
    // never send text through the agent or guess readiness from its cache.
    created = mode !== 'free'
    desk.value = false
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.md-cmd').exists()).toBe(true)
      await w.find('.md-cmd').trigger('click')
      expect(menuState.items.map(i => i.label)).toContain('Run in split terminal')
      expect(calls).toHaveLength(0)
      await menuState.items.find(i => i.label === 'Run in split terminal')!.run!()
      expect(calls).toEqual([{ pane_id: pane.id, command: 'gcloud auth login' }])
      expect(w.emitted('sent')).toBeUndefined()
    } finally { w.unmount() }
  })
})
