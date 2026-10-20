import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ProjectGroup from '~/components/ProjectGroup.vue'
import AgentCard from '~/components/AgentCard.vue'
import { collapsedRepos, compactList, herdrState } from '~/composables/useHerdr'
import type { Pane } from '#shared/types'
import { type Row, spaceRows } from '#shared/spaces'
import type { LinkedTask, Member, ProjectSection } from '#shared/boardLinks'

const pane = (id: string, p: Partial<Pane> = {}): Pane => ({ id, workspace: id.split(':')[0]!, tab: `${id.split(':')[0]}:t1`, tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null, ...p })
const row = (p: Pane): Row => ({ kind: 'pane', key: p.id, pane: p, lead: p })
const task = (n: number, p: Pane): LinkedTask => ({
  id: `shop/${n}`, repo: 'shop', n, key: `SHOP-${n}`, title: `Task ${n}`, panes: [{ id: p.id, role: 'worker' }],
  workspace: p.workspace, stage: 'working', progress: 40, msg: `Doing ${n}`, since: Date.now() - 60_000,
})

const coord = pane('w1:p1', { agent: 'codex', preview: 'Two tasks under way.' })
const workers = [pane('w2:p1', { status: 'working' }), pane('w3:p1', { status: 'working' })]
const members: Member[] = workers.map((p, i) => ({ row: row(p), task: task(i + 1, p), role: 'worker' }))
function section(over: Partial<ProjectSection> = {}): ProjectSection {
  return {
    id: 'repo:shop', repo: 'shop', key: 'SHOP', info: { repo: 'shop', root: '/tmp/shop', branch: 'main', behind: 0 }, space: null,
    coordinator: row(coord), remote: null, members, sum: { blocked: 0, working: 2, ready: 1, total: 3 }, state: 'working', ...over,
  }
}
const mount = (g: ProjectSection) => {
  herdrState.value = { ok: true, workspaces: [], panes: [coord, ...workers] }
  return mountSuspended(ProjectGroup, { props: { group: g }, global: { stubs: { UContextMenu: { template: '<div><slot /></div>' } } } })
}

describe('a repo group on the home list', () => {
  afterEach(() => { herdrState.value = { ok: false, workspaces: [], panes: [] }; compactList.value = true; collapsedRepos.value = [] })

  it('puts its project coordinator in a lead row of its own, above the tasks', async () => {
    const w = await mount(section())
    const lead = w.find('.project-lead')
    expect(lead.exists()).toBe(true)
    expect(lead.attributes('aria-label')).toBe('shop coordinator')
    // Labelled by its role (the header names the repo), with its own icon and its last message.
    const card = lead.find('.card')
    expect(card.classes()).toContain('home-coord')
    expect(card.find('.card-title').text()).toBe('Coordinator')
    expect(card.find('.avatar.coord').exists()).toBe(true)
    expect(card.find('.home-task-line').text()).toBe('Two tasks under way.')
    // The tasks stay in the tree, with their id chip, and no coordinator among them.
    const tree = w.find('.project-tree')
    expect(tree.findAll('.card').map(c => c.find('.home-task-tag').text())).toEqual(['SHOP-1', 'SHOP-2'])
    expect(tree.find('.home-coord').exists()).toBe(false)
    expect(tree.find('.avatar.coord').exists()).toBe(false)
    // The lead comes first.
    expect(w.html().indexOf('project-lead')).toBeLessThan(w.html().indexOf('project-tree'))
    w.unmount()
  })

  it('a coordinator alone: its lead row, no empty task list', async () => {
    const w = await mount(section({ members: [] }))
    expect(w.find('.project-lead').classes()).toContain('alone')
    expect(w.find('.project-tree').exists()).toBe(false)
    w.unmount()
  })

  it('folded: the coordinator stays in view, its tasks fold under it', async () => {
    const g = section()
    collapsedRepos.value = [`|${g.id}`]
    const w = await mount(g)
    expect(w.find('.project-head').attributes('aria-expanded')).toBe('false')
    expect(w.find('.project-lead .avatar.coord').exists()).toBe(true)
    expect(w.find('.project-lead').classes()).toContain('alone')
    expect(w.find('.project-tree').exists()).toBe(false)
    // The header counts what is folded: two working tasks, not the ready coordinator in view.
    expect(w.find('.project-sum .working').text()).toContain('2')
    expect(w.find('.project-sum .ready').exists()).toBe(false)
    // Unfolded again: the tasks come back under it.
    await w.find('.project-head').trigger('click')
    expect(w.findAll('.project-tree .card')).toHaveLength(2)
    expect(w.find('.project-lead').exists()).toBe(true)
    w.unmount()
  })

  it('no coordinator here: the tasks only', async () => {
    const w = await mount(section({ coordinator: null }))
    expect(w.find('.project-lead').exists()).toBe(false)
    expect(w.findAll('.project-tree .card')).toHaveLength(2)
    w.unmount()
  })

  it('a coordinator that asks something shows its question, not its last message twice', async () => {
    const asking = { ...coord, status: 'blocked' as const, prompt: { question: 'Run the tests?', cursor: 0, options: [{ label: 'Yes', hint: null }, { label: 'No', hint: null }] } }
    herdrState.value = { ok: true, workspaces: [], panes: [asking, ...workers] }
    const w = await mountSuspended(AgentCard, { props: { pane: asking, row: row(asking), board: { tag: '', name: 'Coordinator', coordinator: true } } })
    expect(w.find('.home-task-line').exists()).toBe(false)
    expect(w.find('.card-preview').text()).toBe('Run the tests?')
    w.unmount()
  })

  it('a coordinator sharing its space with a terminal keeps its icon, in both list modes', async () => {
    const shell = pane('w1:p2', { agent: null, status: null })
    const state = { ok: true, workspaces: [{ id: 'w1', label: 'herdr-projects', number: 1, status: null, worktree: false }], panes: [coord, shell] }
    const shared = spaceRows(state)[0]!
    expect(shared.kind).toBe('space')
    for (const compact of [false, true]) {
      compactList.value = compact
      herdrState.value = { ...state, panes: [coord, shell, ...workers] }
      const w = await mountSuspended(ProjectGroup, { props: { group: section({ coordinator: shared }) }, global: { stubs: { UContextMenu: { template: '<div><slot /></div>' } } } })
      const card = w.find('.project-lead .card')
      expect(card.classes()).toContain('space-card')
      expect(card.find('.avatar.coord').exists()).toBe(true)
      expect(card.find('.space-avatar').exists()).toBe(false)
      w.unmount()
    }
  })

  it('the detailed card: no folder line for a coordinator', async () => {
    compactList.value = false
    const w = await mount(section())
    const card = w.find('.project-lead .card')
    expect(card.find('.card-where').exists()).toBe(false)
    expect(card.find('.card-preview').text()).toBe('Two tasks under way.')
    w.unmount()
  })
})
