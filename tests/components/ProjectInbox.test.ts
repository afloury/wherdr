import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import { UApp } from '#components'
import ProjectPanel from '~/components/ProjectPanel.vue'
import { eventsOpen } from '~/composables/useHerdr'
import type { ProjectBoard } from '#shared/projectBoard'
import type { InboxItem } from '#shared/projectInbox'

const board: ProjectBoard = {
  slug: 'acme', version: 'v1', lists: [],
  open: [{ id: 't-0102', title: 'CSV import', group: 'Ready for review', token: 'ready-for-review', rank: 2, resolved: false, updated: '', created: '', agentName: null, machine: '', profile: 'codex', stateLine: '', activity: '', percent: null, pr: '', report: true }],
  resolved: [],
}
const ALL: InboxItem[] = [
  { id: '20260101T000000Z-routine-nightly-1', kind: 'routine', subject: 'nightly', event: 'due', summary: 'Routine nightly is due', created: '', body: 'Run the suite.' },
  { id: '20260102T000000Z-thread-state-t-0102-2', kind: 'thread-state', subject: 't-0102', event: 'new report', summary: 't-0102 has a new report', created: '', body: '' },
]
let items = [...ALL]
const posted: unknown[] = []
registerEndpoint('/api/project/inbox', { method: 'GET', handler: () => ({ items, total: items.length }) })
registerEndpoint('/api/project/inbox', { method: 'POST', handler: async (event) => {
  const body = await readBody(event)
  posted.push(body)
  items = items.filter(x => x.id !== body.id)
  return { ok: true }
} })
registerEndpoint('/api/project/routines', () => ({
  routines: [
    { name: 'nightly', schedule: 'daily 02:30', enabled: true, kind: 'prompt only', when: ['last 2026-01-01 02:30', 'next 2026-01-02 02:30'] },
    { name: 'audit', schedule: 'every 7d', enabled: false, kind: 'command: NOT approved (or edited since approval)', when: ['next - (disabled)'] },
  ],
  broken: [{ file: 'old.md', error: 'missing schedule' }],
}))

async function mountTab(key: string) {
  const Host = defineComponent({ render: () => h(UApp, null, () => h(ProjectPanel, { paneId: `w1:${key}`, board, loading: false, error: '' })) })
  const w = await mountSuspended(Host)
  await w.find(`#pp-tab-${key}`).trigger('click')
  return w
}

describe('ProjectPanel › Inbox and Routines tabs', () => {
  beforeEach(() => { items = [...ALL]; posted.length = 0; eventsOpen.value = true })

  it('has its tabs after Threads', async () => {
    const Host = defineComponent({ render: () => h(UApp, null, () => h(ProjectPanel, { paneId: 'w1:tabs', board, loading: false, error: '' })) })
    const w = await mountSuspended(Host)
    expect(w.findAll('[role="tab"]').slice(0, 4).map(b => b.text())).toEqual(['Tasks', 'Threads1', 'Inbox', 'Routines'])
  })

  it('lists inbox items with the thread’s title, and marks one as handled', async () => {
    const w = await mountTab('inbox')
    await vi.waitFor(() => expect(w.findAll('.pi-card')).toHaveLength(2))
    expect(w.findAll('.pi-title').map(x => x.text())).toEqual(['nightly', 'CSV import'])
    expect(w.findAll('.pi-meta').map(x => x.text())).toEqual(['due', 'T-0102 · new report'])
    expect(w.find('.pi-prompt').text()).toBe('Run the suite.')
    expect(w.find('#pp-tab-inbox').text()).toBe('Inbox2')

    await w.findAll('.pi-done')[1]!.trigger('click')
    await vi.waitFor(() => expect(w.findAll('.pi-card')).toHaveLength(1))
    expect(posted).toEqual([{ pane_id: 'w1:inbox', id: '20260102T000000Z-thread-state-t-0102-2' }])
    expect(w.find('#pp-tab-inbox').text()).toBe('Inbox1')
  })

  it('sends nothing offline, and says when the inbox is empty', async () => {
    const w = await mountTab('inbox')
    await vi.waitFor(() => expect(w.findAll('.pi-card')).toHaveLength(2))
    eventsOpen.value = false
    await w.find('.pi-done').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    expect(posted).toEqual([])
    items = []
    await w.find('button[aria-label="Refresh"]').trigger('click')
    await vi.waitFor(() => expect(w.find('.pi-none').exists()).toBe(true))
  })

  it('shows routines read-only: schedule, state, kind and runs, no action', async () => {
    const w = await mountTab('routines')
    await vi.waitFor(() => expect(w.findAll('.pr-card')).toHaveLength(3))
    expect(w.findAll('.pr-name').map(x => x.text())).toEqual(['nightly', 'audit', 'old.md'])
    expect(w.findAll('.pr-card .pill').map(x => x.text())).toEqual(['Enabled', 'Disabled'])
    expect(w.findAll('.pr-schedule').map(x => x.text())).toEqual(['daily 02:30', 'every 7d'])
    expect(w.find('.pr-card').text()).toContain('next 2026-01-02 02:30')
    expect(w.findAll('.pr-card')[1]!.text()).toContain('command: NOT approved (or edited since approval)')
    expect(w.find('.pr-error').text()).toBe('missing schedule')
    expect(w.findAll('.pr button')).toHaveLength(0)
  })
})
