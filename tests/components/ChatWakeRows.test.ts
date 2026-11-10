import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ChatView from '~/components/ChatView.vue'
import { herdrState } from '~/composables/useHerdr'
import type { ChatItem, Pane } from '#shared/types'

const pane: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/home/user/demo', agentSession: null }
let items: ChatItem[] = []
registerEndpoint('/api/chat', () => ({ available: true, token: 'wakes', file: '/home/user/demo/transcript.jsonl', items }))

const at = (h: number, m = 0) => `2026-01-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
const ACK = (id: string) => `When you have handled this, run: wherdr pm ack ${id}`
// A wake and the coordinator's answer to it.
const wake = (head: string, reason: string, answer: string, h: number): ChatItem[] => [
  { role: 'user', text: `${head}\n\n${reason}\n\n${ACK(head.split(' ').pop()!)}`, ts: at(h) },
  { role: 'assistant', text: answer, ts: at(h, 1) },
]

describe('wakes in a conversation', () => {
  afterEach(() => { herdrState.value = { ok: false, workspaces: [], panes: [] } })

  it('shows wakes as compact rows, folds routine runs, keeps an incident and the user apart', async () => {
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    items = [
      { role: 'user', text: 'Ship the release tonight.', ts: at(7) },
      { role: 'assistant', text: 'On it.', ts: at(7, 1) },
      ...wake('Autopilot: wake a1', 'Scheduled wake', 'Nothing to do.', 8),
      ...wake('Health check: wake h1', 'All tasks moving.', 'All good.', 9),
      ...wake('Autopilot: wake a2', 'Scheduled wake', 'Nothing to do.', 11),
      ...wake('Incident: wake i1', 'WHR-9: stuck: the core is unreachable', 'Restarted the worker.', 12),
      ...wake('Engine: wake e1', 'WHR-7: gave up after 2 fixes', 'Shall I retry it?', 13),
    ]
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] }, global: { stubs: { UTooltip: { template: '<slot />' } } } })
    try {
      await expect.poll(() => w.findAll('[data-testid="wake"]').length).toBe(2)
      // The user's message keeps its bubble; no wake is one.
      expect(w.findAll('.msg-user')).toHaveLength(1)
      expect(w.find('.msg-user').text()).toContain('Ship the release tonight.')

      // Three routine wakes: one row, folded.
      const run = w.find('[data-testid="wake-run"]')
      expect(run.text()).toContain('3 routine checks')
      expect(run.text()).toContain('–')

      // The incident stays visible with its answer, compact and loud.
      const [incident, engine] = w.findAll('[data-testid="wake"]')
      expect(incident!.attributes('data-kind')).toBe('incident')
      expect(incident!.classes()).toContain('loud')
      expect(incident!.find('.wake-head').text()).toBe('WHR-9: stuck: the core is unreachable')
      expect(incident!.find('.wake-answer').text()).toBe('Restarted the worker.')
      expect(incident!.text()).not.toContain('wherdr pm ack')

      // An answer that asks the user stays a full reply under its row.
      expect(engine!.classes()).toContain('loud')
      expect(engine!.find('.wake-answer').exists()).toBe(false)
      expect(w.find('.chat').text()).toContain('Shall I retry it?')

      // Search reads inside the folds: a reply hidden in the run is found.
      expect(w.find('.chat').text()).not.toContain('All good.')
      await w.setProps({ search: true })
      await w.find('.search-bar input').setValue('all good')
      await expect.poll(() => w.find('.search-count').text()).toBe('1/1')
      expect(w.find('.chat').text()).toContain('All good.')
      await w.setProps({ search: false })
      await expect.poll(() => w.find('.chat').text()).not.toContain('All good.')

      // Tapping the run shows its wakes; tapping one shows its full text.
      await run.trigger('click')
      expect(w.findAll('[data-testid="wake"]')).toHaveLength(5)
      const first = w.find('[data-testid="wake"]')
      expect(first.find('.wake-head').text()).toBe('Scheduled wake')
      await first.find('.wake-row').trigger('click')
      expect(w.find('.wake-text').text()).toContain('wherdr pm ack a1')
    } finally { w.unmount() }
  })
})
