import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { UApp } from '#components'
import BoardView from '~/components/BoardView.vue'
import type { Pane } from '#shared/types'
import type { GlobalBoard } from '#shared/globalBoard'
import type { ProjectTask } from '#shared/projectBoard'
import { desk, eventsOpen, herdrState } from '~/composables/useHerdr'
import { menuState } from '~/composables/useUi'
import { useRouter } from '#imports'

const pane = (over: Partial<Pane>): Pane => ({
  id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null,
  status: 'idle', title: null, cwd: null, agentSession: null, ...over,
})
const task = (text: string, done = false): ProjectTask => ({ text, done, owner: 'me', thread: null })

const local = pane({ id: 'w1:p1', cwd: '/home/user/.herdr-projects/acme-shop' })
const remote = pane({ id: 'host-a~w1:p1', machine: 'host-a', cwd: '/home/user/.herdr-projects/beta-api' })
const shell = pane({ id: 'w2:p1', workspace: 'w2', tab: 'w2:t1', label: 'Notes agent', status: 'working', cwd: '/home/user/notes' })

const finished = Array.from({ length: 7 }, (_, i) => task(`Shipped item ${i + 1}`, true))
const reply: GlobalBoard = {
  version: 'v1',
  projects: [
    {
      key: 'acme-shop', slug: 'acme-shop', panes: [local.id],
      board: {
        slug: 'acme-shop', version: 'b1', open: [], resolved: [],
        lists: [
          { title: 'To do', kind: 'todo', tasks: [task('Webhook retries'), { ...task('Checkout page'), badges: [{ text: 't-0007', color: 'gray', thread: 't-0007' }] }] },
          { title: 'In progress', kind: 'doing', tasks: [task('OpenAPI spec')] },
          { title: 'Done', kind: 'done', tasks: finished },
        ],
      },
    },
    { key: 'host-a|beta-api', slug: 'beta-api', panes: [remote.id], board: null },
  ],
}
registerEndpoint('/api/board', () => reply)

async function mountBoard() {
  const Host = defineComponent({ render: () => h(UApp, null, () => h(BoardView)) })
  const w = await mountSuspended(Host)
  await flushPromises()
  return w
}
const column = (w: Awaited<ReturnType<typeof mountBoard>>, id: string) => w.get(`section.board-col.${id}`)

describe('BoardView', () => {
  const before = herdrState.value
  beforeAll(() => {
    desk.value = false
    eventsOpen.value = true
  })
  afterEach(() => { herdrState.value = before })
  const setPanes = () => {
    herdrState.value = {
      ok: true, workspaces: [], panes: [local, remote, shell],
      machines: [{ key: 'host-a', label: 'Host A', local: false, status: 'online', error: null }],
    }
  }

  it('puts tasks and agents in their column', async () => {
    setPanes()
    const w = await mountBoard()
    expect(column(w, 'todo').text()).toContain('Webhook retries')
    expect(column(w, 'ongoing').text()).toContain('OpenAPI spec')
    expect(column(w, 'ongoing').text()).toContain('Notes agent')
    expect(column(w, 'finished').text()).toContain('Shipped item 1')
    expect(column(w, 'todo').text()).not.toContain('OpenAPI spec')
  })

  it('uses a neutral badge for a resolved thread card', async () => {
    setPanes()
    const board = reply.projects[0]!.board!
    const lists = board.lists
    board.lists = []
    board.resolved = [{
      id: 't-0003', title: 'Old work', group: 'Resolved', token: 'resolved', rank: 6, resolved: true,
      updated: '', created: '', agentName: null, machine: '', profile: 'claude', stateLine: '', activity: '', percent: null, pr: '', report: false,
    }]
    try {
      const w = await mountBoard()
      const badge = column(w, 'finished').get('.board-card.thread .pill')
      expect(badge.text()).toBe('Done')
      expect(badge.classes()).toContain('inactive')
      expect(badge.classes()).not.toContain('idle')
    } finally {
      board.lists = lists
      board.resolved = []
    }
  })

  it('a task card offers only the columns it can move to', async () => {
    setPanes()
    const w = await mountBoard()
    const card = column(w, 'todo').findAll('.board-card').find(c => c.text().includes('Webhook retries'))!
    await card.get(`button[aria-label="${t('Move to…')}"]`).trigger('click')
    await flushPromises()
    expect(menuState.items.map(i => i.label)).toEqual([t('Blocked'), t('Ongoing'), t('Finished')])
  })

  it('names the machine of a project on another machine', async () => {
    setPanes()
    const w = await mountBoard()
    const cards = w.findAll('.board-card.project')
    expect(cards.find(c => c.text().includes('beta-api'))!.text()).toContain('Host A')
    expect(cards.find(c => c.text().includes('acme-shop'))!.text()).not.toContain('Host A')
  })

  it('caps the Finished column until Show all', async () => {
    setPanes()
    const w = await mountBoard()
    const shipped = () => column(w, 'finished').findAll('.board-card.task').length
    expect(shipped()).toBe(5)
    const more = column(w, 'finished').get('.board-more')
    expect(more.text()).toContain('2')
    await more.trigger('click')
    expect(shipped()).toBe(7)
    expect(column(w, 'finished').find('.board-more').exists()).toBe(false)
  })

  it('leaves out the projects hidden on this device, counters included', async () => {
    setPanes()
    localStorage.setItem('boardHiddenProjects', JSON.stringify(['|acme-shop']))
    try {
      const w = await mountBoard()
      expect(w.get('.board-seg-btn.todo b').text()).toBe('0')
      expect(w.text()).not.toContain('Webhook retries')
      expect(w.findAll('.board-card.project').map(c => c.text()).join()).toContain('beta-api')
      expect(column(w, 'ongoing').text()).toContain('Notes agent')
      expect(w.get('.board-filter').attributes('aria-label')).toBe('Filter projects: 1 hidden')
    } finally {
      localStorage.removeItem('boardHiddenProjects')
    }
  })

  it('a click on a task opens its Project panel, a click on its badge does not', async () => {
    setPanes()
    const w = await mountBoard()
    const router = useRouter()
    await router.replace('/board')
    // Every navigation the clicks start, in order, and the first one landing.
    const went: string[] = []
    const landed = Promise.withResolvers<void>()
    const stops = [router.beforeEach((to) => { went.push(to.path) }), router.afterEach(() => landed.resolve())]
    const card = column(w, 'todo').findAll('.board-card').find(c => c.text().includes('Checkout page'))!
    await card.get('button.pp-badge').trigger('click')
    await card.get('.board-card-label').trigger('click')
    await landed.promise
    for (const stop of stops) stop()
    expect(went).toEqual([`/a/${local.id}`])
    expect(router.currentRoute.value.path).toBe(`/a/${local.id}`)
  })
})
