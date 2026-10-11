import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { getQuery, readBody } from 'h3'
import { UApp } from '#components'
import ProjectPanel from '~/components/ProjectPanel.vue'
import { answerConfirm, confirmState } from '~/composables/useUi'
import { eventsOpen } from '~/composables/useHerdr'
import type { ProjectBoard, ProjectThread } from '#shared/projectBoard'

const thread = (id: string, over: Partial<ProjectThread> = {}): ProjectThread => ({
  id, title: `Thread ${id}`, group: 'Working', token: 'working', rank: 4, resolved: false,
  updated: '', created: '', agentName: null, machine: '', profile: 'claude', stateLine: '', activity: '', percent: null, pr: '', report: false, ...over,
})
const done = (n: number) => thread(`t-${String(n).padStart(4, '0')}`, { group: 'Resolved', token: 'resolved', rank: 6, resolved: true, title: `Old work ${n}` })
const board: ProjectBoard = {
  slug: 'acme', version: 'v1',
  lists: [{ title: 'To test', kind: 'test', tasks: [{ text: 'Webhook retries', done: false, owner: 'me', thread: null }] }],
  open: [
    thread('t-0103', { group: 'Waiting on you', token: 'waiting-on-you', rank: 1, title: 'Flaky export', machine: 'Laptop', profile: 'codex' }),
    thread('t-0102', { group: 'Ready for review', token: 'ready-for-review', rank: 2, title: 'CSV import', report: true, stateLine: 'review · report' }),
    thread('t-0101', { title: 'Rate limits' }),
  ],
  resolved: Array.from({ length: 35 }, (_, i) => done(35 - i)),
}

const asked: string[] = []
const posted: unknown[] = []
registerEndpoint('/api/project/thread', { method: 'GET', handler: (event) => {
  const id = String(getQuery(event).id)
  asked.push(id)
  const th = [...board.open, ...board.resolved].find(x => x.id === id)!
  return { thread: {
    ...th, note: '', error: '', kind: 'worktree', agent: th.profile, branch: `hp/acme/${id}-work`, base: 'origin/main', prState: '', prReview: '',
    next: th.report ? ['Merge the branch', 'Remove the worktree'] : [], acked: false, hasPane: !th.resolved, keptWorktree: false, resolvedReason: '',
  } }
} })
registerEndpoint('/api/project/thread', { method: 'POST', handler: async (event) => {
  const body = await readBody(event)
  posted.push(body)
  return { output: `${body.id}: done` }
} })

async function mountThreads() {
  const reloads: number[] = []
  const Host = defineComponent({ render: () => h(UApp, null, () => h(ProjectPanel, { paneId: 'w1:p1', board, loading: false, error: '', onReload: () => reloads.push(1) })) })
  const w = await mountSuspended(Host)
  await w.find('#pp-tab-threads').trigger('click')
  return { w, reloads }
}
const inBody = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]

describe('ProjectPanel › Threads tab', () => {
  beforeEach(() => { asked.length = 0; posted.length = 0; eventsOpen.value = true })

  it('switches between the Tasks and Threads tabs', async () => {
    const Host = defineComponent({ render: () => h(UApp, null, () => h(ProjectPanel, { paneId: 'w9:p9', board, loading: false, error: '' })) })
    const w = await mountSuspended(Host)
    expect(w.findAll('[role="tab"]').map(b => [b.text(), b.attributes('aria-selected')])).toEqual([['Tasks', 'true'], ['Threads3', 'false']])
    expect(w.text()).toContain('Webhook retries')
    await w.find('#pp-tab-threads').trigger('click')
    expect(w.find('#pp-tab-threads').attributes('aria-selected')).toBe('true')
    expect(w.text()).not.toContain('Webhook retries')
    expect(w.text()).toContain('Rate limits')
  })

  it('lists open threads under their group, with machine and profile, and keeps resolved ones folded', async () => {
    const { w } = await mountThreads()
    expect(w.findAll('.pt-group-head').map(x => x.text())).toEqual(['Your turn1', 'Ready for review1', 'Working1'])
    expect(w.find('.pt-group .pp-meta').text()).toBe('T-0103 · Laptop · codex')
    const head = w.find('.pt-resolved .pp-sec-head')
    expect(head.text()).toContain('35')
    expect(head.attributes('aria-expanded')).toBe('false')
    expect(w.findAll('.pt-resolved .pp-row')).toHaveLength(0)
    await head.trigger('click')
    expect(w.findAll('.pt-resolved .pp-row')).toHaveLength(30)
    await w.find('.pt-resolved .pp-more').trigger('click')
    expect(w.findAll('.pt-resolved .pp-row')).toHaveLength(35)
  })

  it('filters open and resolved threads together', async () => {
    const { w } = await mountThreads()
    await w.find('.pt-filter input').setValue('old work 12')
    expect(w.findAll('.pt-group')).toHaveLength(0)
    expect(w.findAll('.pt-resolved .pp-thread-title').map(x => x.text())).toEqual(['Old work 12'])
    await w.find('.pt-filter input').setValue('csv')
    expect(w.findAll('.pt-group .pp-thread-title').map(x => x.text())).toEqual(['CSV import'])
    await w.find('.pt-filter input').setValue('')
  })

  it('shows a thread’s record, its Next list and its actions; Resolve asks first', async () => {
    const { w, reloads } = await mountThreads()
    await w.findAll('.pt-group .pt-thread')[1]!.trigger('click')
    await vi.waitFor(() => expect(inBody('.pt-next li')).toHaveLength(2))
    expect(asked).toEqual(['t-0102'])
    expect(inBody('.pt-next li').map(x => x.textContent)).toEqual(['1Merge the branch', '2Remove the worktree'])
    expect(inBody('.pt-facts dd').map(x => x.textContent)).toContain('hp/acme/t-0102-work ← origin/main')
    expect(inBody('.pt-actions button').map(x => x.textContent!.trim())).toEqual(['Acknowledge', 'Restart', 'Resolve'])

    // Resolve: nothing is sent until the confirmation is accepted.
    inBody('.pt-act-resolve')[0]!.click()
    await flushPromises()
    expect(confirmState.open).toBe(true)
    expect(confirmState.message).toContain('T-0102')
    answerConfirm(false)
    await flushPromises()
    expect(posted).toEqual([])
    inBody('.pt-act-resolve')[0]!.click()
    await flushPromises()
    answerConfirm(true)
    await flushPromises()
    await vi.waitFor(() => expect(reloads).toHaveLength(1))
    expect(posted).toEqual([{ pane_id: 'w1:p1', id: 't-0102', action: 'resolve' }])

    // Acknowledge is sent at once.
    await vi.waitFor(() => expect(inBody('.pt-act-ack')[0]!.hasAttribute('disabled')).toBe(false))
    inBody('.pt-act-ack')[0]!.click()
    await vi.waitFor(() => expect(posted.at(-1)).toEqual({ pane_id: 'w1:p1', id: 't-0102', action: 'ack' }))
  })

  it('sends nothing offline', async () => {
    const { w } = await mountThreads()
    eventsOpen.value = false
    const before = inBody('.pt-act-ack').length
    await w.findAll('.pt-group .pt-thread')[1]!.trigger('click')
    await vi.waitFor(() => expect(inBody('.pt-act-ack').length).toBeGreaterThan(before))
    inBody('.pt-act-ack').at(-1)!.click()
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))
    expect(posted).toEqual([])
  })
})
