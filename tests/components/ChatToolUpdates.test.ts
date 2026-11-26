import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { defineComponent, h, shallowRef } from 'vue'
import { getQuery } from 'h3'
import { UApp } from '#components'
import ChatView from '~/components/ChatView.vue'
import { herdrState } from '~/composables/useHerdr'
import type { ChatResponse, Pane } from '#shared/types'

const cmdPane = (over: Partial<Pane> = {}): Pane => ({
  id: 'w1:p9',
  workspace: 'w1',
  tab: 'w1:t1',
  tabLabel: null,
  agent: 'cmd',
  name: null,
  label: null,
  status: 'idle',
  title: null,
  cwd: '/home/alice/acme-shop',
  agentSession: null,
  ...over,
})

let handler: (query: Record<string, string>) => ChatResponse = () => ({ available: false, reason: 'not_found' })
registerEndpoint('/api/chat', (event) => handler(getQuery(event) as Record<string, string>))

const current = shallowRef<Pane>(cmdPane())

async function mountCmd(pane = cmdPane()) {
  current.value = pane
  herdrState.value = { ok: true, workspaces: [], panes: [pane] }
  const Host = defineComponent({ render: () => h(UApp, null, () => h(ChatView, { pane: current.value, localQueued: [] })) })
  return mountSuspended(Host)
}

describe('ChatView Command Code updates & availability', () => {
  afterEach(() => {
    vi.useRealTimers()
    herdrState.value = { ok: false, workspaces: [], panes: [] }
  })

  it('applies toolUpdates arriving on subsequent polls and treats cmd unavailable as authoritative', async () => {
    let phase: 'initial' | 'updated' | 'gone' = 'initial'
    handler = () => {
      if (phase === 'gone') return { available: false, reason: 'not_found' }
      return {
        available: true,
        file: 's1.jsonl',
        token: phase === 'initial' ? 'tok-1' : 'tok-2',
        start: 0,
        items: [
          { role: 'user', text: 'check build', ts: '2026-01-01T00:00:00Z' },
          { role: 'tool', name: 'Bash', text: 'npm test', toolId: 'call-1', ts: '2026-01-01T00:00:01Z' },
        ],
        ...(phase === 'updated'
          ? { toolUpdates: [{ id: 'call-1', at: 500, out: 'exit 1', error: true, images: 0, ref: '', imageAt: 0 }] }
          : {}),
      }
    }

    const w = await mountCmd()
    await expect.poll(() => w.find('.chat').text()).toContain('npm test')
    expect(w.find('.tools .err').exists()).toBe(false)

    phase = 'updated'
    await w.findComponent(ChatView).vm.reload?.()
    await expect.poll(() => w.find('.tools .err').exists()).toBe(true)

    // Command Code selections are authoritative: one not_found clears at once
    // without the multi-miss grace used by file-following readers.
    phase = 'gone'
    await w.findComponent(ChatView).vm.reload?.()
    await expect.poll(() => w.text()).toContain('No conversation for this agent yet.')
  })

  it('shows unavailable immediately for cmd panes with missing transcripts', async () => {
    handler = () => ({ available: false, reason: 'not_found' })
    const w = await mountCmd(cmdPane({ agentSession: 's-other' }))
    await expect.poll(() => w.text()).toContain('No conversation for this agent yet.')
  })
})
