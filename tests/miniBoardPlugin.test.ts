// @vitest-environment happy-dom
// mini-board example plugin (built index.js) on a fake host: the Board entry, a project's
// tasks with a worker's live state, Add task (read again, then written) and Start coordinator.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createPluginHost, type PluginAgent } from '../app/utils/pluginHost'

const url = pathToFileURL(resolve(__dirname, '../examples/plugins/mini-board/index.js')).href
const FILE = '/home/u/app/.wherdr/tasks.json'
const hosts: ReturnType<typeof createPluginHost>[] = []

function setup(initial: string | null) {
  let file = initial
  const agents: PluginAgent[] = [
    { id: 'w1:p1', name: 'claude', agent: 'claude', status: 'idle', labels: {}, folder: '/home/u/app', machine: '' },
    { id: 'w1:p2', name: 'wherdr-t1', agent: 'claude', status: 'blocked', labels: { 'wherdr.task': 't1', 'wherdr.project': '/home/u/app' }, folder: '/home/u/app/.wherdr/worktrees/t1', machine: '' },
  ]
  const deps = {
    readFile: vi.fn(async (_m: string, p: string) => (p === FILE ? file : null)),
    writeFile: vi.fn(async (_m: string, _p: string, t: string) => { file = t }),
    startAgent: vi.fn(async () => ({ id: 'w1:p3', name: 'coord-app', firstMessage: 'sent' as const })),
    openAgent: vi.fn(),
  }
  const host = createPluginHost({
    list: async () => [{ id: 'mini-board', name: 'Mini-board', version: '0.1.0', description: '', main: 'index.js' }],
    load: () => import(/* @vite-ignore */ url),
    insertDraft: () => {}, currentAgent: () => null, subscribeNavigate: () => () => {},
    prefs: () => ({ off: [], failed: {} }), savePrefs: () => {}, changed: () => {}, timeoutMs: 1000,
    agents: () => agents, subscribeAgents: () => () => {}, ...deps,
  })
  hosts.push(host)
  return { host, deps, file: () => file }
}
const flush = () => new Promise(r => setTimeout(r, 0))

afterEach(async () => {
  for (const h of hosts.splice(0)) await h.setEnabled('mini-board', false)
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('mini-board plugin', () => {
  it('adds a Board entry to the home, lists the project, not the worker\'s worktree', async () => {
    document.body.innerHTML = '<section data-wherdr="home-list"><header class="home-top"></header></section>'
    const s = setup(null)
    await s.host.init()
    expect(s.host.rows()[0]!.status).toBe('running')
    const entry = document.querySelector<HTMLButtonElement>('[data-mini-board="entry"]')!
    expect(entry.textContent).toContain('Board')
    expect(entry.textContent).toContain('1 project')
    entry.click()
    const rows = [...document.querySelectorAll<HTMLElement>('[data-project]')].map(r => r.dataset.project)
    expect(rows).toEqual(['/home/u/app'])
  })

  it('shows the tasks with the worker\'s live state; a tap opens the worker', async () => {
    document.body.innerHTML = '<section data-wherdr="home-list"></section>'
    const s = setup(JSON.stringify({ tasks: [{ id: 't1', title: 'Add a README line', status: 'working', terminal: 't7', notes: 'Needs you: allow the edit?' }, { id: 't2', title: 'Later', status: 'todo' }] }))
    await s.host.init()
    document.querySelector<HTMLButtonElement>('[data-mini-board="entry"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-project="/home/u/app"]')!.click()
    await flush()
    const t1 = document.querySelector<HTMLButtonElement>('[data-task="t1"]')!
    expect(t1.textContent).toContain('Add a README line')
    expect(t1.textContent).toContain('Worker needs you')
    expect(t1.textContent).toContain('Needs you: allow the edit?')
    expect(document.querySelector<HTMLButtonElement>('[data-task="t2"]')!.disabled).toBe(true)
    t1.click()
    expect(s.deps.openAgent).toHaveBeenCalledWith('w1:p2')
  })

  it('adds a task (file read again, then written) and starts the coordinator with its labels', async () => {
    document.body.innerHTML = '<section data-wherdr="home-list"></section>'
    const s = setup(null)
    await s.host.init()
    document.querySelector<HTMLButtonElement>('[data-mini-board="entry"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-project="/home/u/app"]')!.click()
    await flush()
    const title = document.querySelector<HTMLInputElement>('[data-mb="title"]')!
    title.value = 'Add a README line'
    title.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(s.deps.writeFile).toHaveBeenCalled())
    expect(JSON.parse(s.file()!).tasks).toEqual([expect.objectContaining({ id: 't1', title: 'Add a README line', status: 'todo' })])
    await vi.waitFor(() => expect(document.querySelector('[data-task="t1"]')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('[data-mini-board="start-coordinator"]')!.click()
    await vi.waitFor(() => expect(s.deps.startAgent).toHaveBeenCalled())
    const o = (s.deps.startAgent.mock.calls[0] as unknown[])[0] as { folder: string, agent: string, name: string, labels: object, firstMessage: string }
    expect(o).toMatchObject({ folder: '/home/u/app', agent: 'claude', name: 'coord-app', labels: { 'wherdr.role': 'coordinator', 'wherdr.project': '/home/u/app' } })
    expect(o.firstMessage).toContain(FILE)
    expect(o.firstMessage).toContain('hc run --bg')
    await vi.waitFor(() => expect(s.deps.openAgent).toHaveBeenCalledWith('w1:p3'))
  })

  it('never writes over a file it cannot parse', async () => {
    document.body.innerHTML = '<section data-wherdr="home-list"></section>'
    const s = setup('{"tasks": [')
    await s.host.init()
    document.querySelector<HTMLButtonElement>('[data-mini-board="entry"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-project="/home/u/app"]')!.click()
    await flush()
    expect(document.querySelector('.mb-msg.error')!.textContent).toMatch(/Invalid JSON/)
    expect(document.querySelector<HTMLButtonElement>('[data-mini-board="start-coordinator"]')!.disabled).toBe(true)
    expect(s.deps.writeFile).not.toHaveBeenCalled()
  })

  it('leaves the page as it was when switched off', async () => {
    document.body.innerHTML = '<section data-wherdr="home-list"></section>'
    const s = setup(null)
    await s.host.init()
    document.querySelector<HTMLButtonElement>('[data-mini-board="entry"]')!.click()
    await s.host.setEnabled('mini-board', false)
    expect(document.querySelector('.mb-entry, .mb-panel, #mini-board-style')).toBeNull()
  })
})
