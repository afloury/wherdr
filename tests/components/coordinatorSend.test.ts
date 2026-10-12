import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import type { Pane } from '#shared/types'
import type { ProjectBoard, ProjectThread } from '#shared/projectBoard'
import { eventsOpen, herdrState } from '~/composables/useHerdr'
import { panePath } from '~/composables/useWorkspaces'
import { isSent, markSent, pruneSent, sendTask, sendToCoordinator, sentKey } from '~/composables/useCoordinatorSend'
import { openThread } from '~/composables/useThreadReport'

// Coordinator messages as the server receives them: the route, and the text.
const posts: { route: string, text: string }[] = []
let hold: Promise<void> | null = null
for (const route of ['/api/prompt', '/api/input']) {
  registerEndpoint(route, {
    method: 'POST',
    handler: async (event) => {
      posts.push({ route, text: String((await readBody<{ text?: string }>(event))?.text ?? '') })
      if (hold) await hold
      return { ok: true }
    },
  })
}

const { navigated } = vi.hoisted(() => ({ navigated: [] as string[] }))
mockNuxtImport('navigateTo', () => (to: string) => { navigated.push(to) })

const board = (...lists: ProjectBoard['lists']): ProjectBoard => ({ slug: 'acme-shop', version: 'v1', lists, open: [], resolved: [] })
const task = (text: string) => ({ text, done: false, owner: 'me', thread: null })

describe('Sent store', () => {
  it('drops a key when its task leaves that kind of list, keeps it otherwise', () => {
    const sent = sentKey('test', 'tested', 'Webhook retries')
    const kept = sentKey('todo', 'queue', 'a | b')
    markSent('w1:p1', sent)
    markSent('w1:p1', kept)
    markSent('w1:p2', sent)
    expect(isSent('w1:p1', sent)).toBe(true)

    // The tested task moved to Blocked: gone from "To test". The other one stays (text with a pipe).
    pruneSent('w1:p1', board(
      { title: 'Blocked', kind: 'blocked', tasks: [task('Webhook retries')] },
      { title: 'To do', kind: 'todo', tasks: [task('a | b')] },
    ))
    expect(isSent('w1:p1', sent)).toBe(false)
    expect(isSent('w1:p1', kept)).toBe(true)
    // Another coordinator's state is untouched.
    expect(isSent('w1:p2', sent)).toBe(true)
  })
})

const pane = (over: Partial<Pane>): Pane => ({
  id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null,
  status: 'idle', title: null, cwd: null, agentSession: null, ...over,
})
const thread = (over: Partial<ProjectThread> = {}): ProjectThread => ({
  id: 't-0007', title: 'Webhook retries', group: 'Working', token: 'working', rank: 4, resolved: false,
  updated: '', created: '', agentName: null, machine: '', activity: '', percent: null, pr: '', report: false, ...over,
})

describe('openThread', () => {
  const before = herdrState.value
  beforeEach(() => { navigated.length = 0 })
  afterEach(() => { herdrState.value = before })

  it('opens the hpThread pane of a tab thread, which has no pane name', () => {
    const coordinator = pane({ id: 'w1:p1', cwd: '/home/user/.herdr-projects/acme-shop' })
    const tabThread = pane({ id: 'w2:p3', hpThread: 'acme-shop/t-0007', cwd: '/home/user/acme-shop' })
    herdrState.value = { ok: true, workspaces: [], panes: [coordinator, tabThread] }
    openThread(coordinator, 'acme-shop', thread())
    expect(navigated).toEqual([panePath('w2:p3')])
  })

  it('tells the user when no agent and no report exist', () => {
    const coordinator = pane({ id: 'w1:p1', cwd: '/home/user/.herdr-projects/acme-shop' })
    herdrState.value = { ok: true, workspaces: [], panes: [coordinator] }
    openThread(coordinator, 'acme-shop', thread())
    expect(navigated).toEqual([])
  })
})

describe('messages to a coordinator', () => {
  const before = herdrState.value
  beforeEach(() => {
    posts.length = 0
    hold = null
    eventsOpen.value = true
  })
  afterEach(() => { herdrState.value = before })

  it('never types into a coordinator waiting on a question: the message goes through the queue', async () => {
    // Claude blocked on a question: a plain send would type the text into it and press Enter.
    const asking = pane({ status: 'blocked', prompt: { question: 'Allow tool: bash', cursor: 0, options: [{ label: 'Yes' }, { label: 'No' }] } as Pane['prompt'] })
    herdrState.value = { ok: true, workspaces: [], panes: [asking] }
    expect(await sendToCoordinator(asking.id, '↳ Mark done: Export to CSV')).not.toBe(false)
    expect(posts).toEqual([{ route: '/api/prompt', text: '↳ Mark done: Export to CSV' }])
  })

  it('refuses a coordinator pane that no longer runs an agent', async () => {
    const shell = pane({ agent: null, status: null })
    herdrState.value = { ok: true, workspaces: [], panes: [shell] }
    expect(await sendToCoordinator(shell.id, '↳ Mark done: Export to CSV')).toBe(false)
    expect(posts).toEqual([])
  })

  it('sends one task message at a time, and an action once', async () => {
    const coordinator = pane({})
    herdrState.value = { ok: true, workspaces: [], panes: [coordinator] }
    const gate = Promise.withResolvers<void>()
    hold = gate.promise
    const first = sendTask(coordinator.id, 'todo', 'block', 'Export to CSV', '↳ Mark blocked: Export to CSV')
    // A second move while the first is on its way (a tap and a drop): refused.
    expect(await sendTask(coordinator.id, 'todo', 'done', 'Export to CSV', '↳ Mark done: Export to CSV')).toBe(false)
    gate.resolve()
    expect(await first).not.toBe(false)
    // The same action again, once sent: nothing.
    expect(await sendTask(coordinator.id, 'todo', 'block', 'Export to CSV', '↳ Mark blocked: Export to CSV')).toBe(false)
    expect(posts.map(p => p.text)).toEqual(['↳ Mark blocked: Export to CSV'])
  })
})
