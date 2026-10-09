import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { UApp } from '#components'
import ProjectPanel from '~/components/ProjectPanel.vue'
import type { ProjectBoard } from '#shared/projectBoard'

const board: ProjectBoard = {
  slug: 'acme',
  version: 'v1',
  lists: [
    { title: 'To test', kind: 'test', tasks: [{ text: 'Webhook retries', done: false, owner: 'me', thread: null }] },
    { title: 'In queue', kind: 'queue', tasks: [{ text: 'OpenAPI spec', done: false, owner: 'agent', thread: null }] },
  ],
  open: [],
  resolved: [],
}

describe('ProjectPanel', () => {
  // The board is already known when the panel mounts (cached from an earlier
  // opening, or answered before the first render): its lists show at once.
  it('mounts with a board already loaded', async () => {
    // Inside UApp, like in the app (its tooltips need the provider).
    const Host = defineComponent({ render: () => h(UApp, null, () => h(ProjectPanel, { paneId: 'w1:p1', board, loading: false, error: '' })) })
    const w = await mountSuspended(Host)
    expect(w.text()).toContain('Webhook retries')
    expect(w.text()).toContain('OpenAPI spec')
  })

  // Add info: on the card of an open thread, and on an In progress task whose
  // thread has no card; never on a task without a thread or with a closed one.
  it('offers Add info on working threads only', async () => {
    const thread = (id: string, resolved: boolean) => ({
      id, title: `Thread ${id}`, group: resolved ? 'Resolved' : 'Working', token: resolved ? 'resolved' : 'working', rank: resolved ? 6 : 4, resolved,
      updated: '', created: '', agentName: null, machine: '', activity: '', percent: null, pr: '', report: false,
    })
    const doing: ProjectBoard = {
      ...board,
      lists: [{ title: 'In progress', kind: 'doing', tasks: [
        { text: 'Shown through its card', done: false, owner: 'agent → t-0012', thread: 't-0012' },
        { text: 'Thread without a card', done: false, owner: 'agent → t-0014', thread: 't-0014' },
        { text: 'Closed thread', done: false, owner: 'agent → t-0010', thread: 't-0010' },
        { text: 'No thread yet', done: false, owner: 'agent', thread: null },
      ] }],
      open: [thread('t-0012', false)],
      resolved: [thread('t-0010', true)],
    }
    const Host = defineComponent({ render: () => h(UApp, null, () => h(ProjectPanel, { paneId: 'w1:p1', board: doing, loading: false, error: '' })) })
    const w = await mountSuspended(Host)
    const labels = w.findAll('button[aria-label^="Add info: "], button[aria-label^="Ajouter une info : "]').map(b => b.attributes('aria-label')!.replace(/^.*?: /, ''))
    expect(labels).toEqual(['Thread t-0012', 'Thread without a card'])
  })
})
