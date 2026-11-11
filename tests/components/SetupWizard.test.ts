import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import SetupWizard from '~/components/SetupWizard.vue'
import SetupButton from '~/components/SetupButton.vue'
import type { PmOverview } from '#shared/pm/project'
import type { CoordinatorView } from '#shared/pm/coordinator'
import { vibe } from '#shared/pm/examples'
import { herdrState } from '~/composables/useHerdr'
import type { Pane } from '#shared/types'

// What the fake server answers; each case sets it before mounting.
let overview: PmOverview
let coords: Partial<CoordinatorView>[] = []
registerEndpoint('/api/pm/overview', () => overview)
registerEndpoint('/api/pm/coordinators', () => coords)
registerEndpoint('/api/pm/project', () => ({ workflow: vibe, log: [] }))
registerEndpoint('/api/pm/enabled', { method: 'POST', handler: () => { overview = { ...overview, enabled: true }; return overview } })

registerEndpoint('/api/pm/repos', () => ({ home: '/home/u', repos: ['/home/u/web'] }))
registerEndpoint('/api/pm/folder', () => ({ path: '/home/u/web', exists: true, git: true, remote: false, empty: false }))
let added: Record<string, unknown> | null = null
registerEndpoint('/api/pm/project', { method: 'POST', handler: async (e) => {
  added = await readBody(e)
  const p = { ...project(String(added!.key)), visibility: { value: 'public', by: 'check', at: 1 } }
  overview = { ...overview, projects: [...overview.projects, p] }
  return { project: p }
} })

const project = (key: string, template?: string) => ({ key, name: key, machine: '', path: `~/${key}`, addedAt: 1, ...(template ? { from: { template, version: 1 } } : {}) })
const task = (p: string) => ({ id: `${p}-1`, project: p, title: 'First', type: 'simple' }) as unknown as NonNullable<PmOverview['tasks']>[number]

let mounted: { unmount: () => void } | null = null
afterEach(() => { mounted?.unmount(); mounted = null; coords = []; added = null; herdrState.value = { ok: false, panes: [], workspaces: [] } })
// The coordinator's live pane, as herdr-core shows it.
const coordPane = (status: Pane['status']) => ({ id: 'w1:p1', coreAddress: 'host/t1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status, title: null, cwd: null, agentSession: null }) as Pane

// The newest match: a sheet of the previous case may still be closing.
const $ = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)].pop()
const stepShown = () => $('setup-wizard')?.dataset.step
async function wizard(props: { project?: string, adding?: boolean } = {}) {
  mounted = await mountSuspended(SetupWizard, { props: { open: true, ...props } })
  await vi.waitFor(() => expect($('setup-wizard')).toBeTruthy())
  await vi.waitFor(() => expect(document.body.textContent).not.toContain('Loading…'))
}
const click = async (id: string) => { $(id)!.click(); await new Promise(r => setTimeout(r, 0)) }

it('starts at the first step with nothing set up, and Next waits for the step to be done', async () => {
  overview = { enabled: false, projects: [], templates: [], tasks: [] }
  await wizard()
  await vi.waitFor(() => expect(stepShown()).toBe('enable'))
  expect($('setup-count')!.textContent).toContain('Step 1 of 6')
  expect($('setup-alfred')).toBeTruthy()
  expect($('setup-next')!.hasAttribute('disabled')).toBe(true)
  await vi.waitFor(() => expect($('setup-enable')).toBeTruthy())
  await click('setup-enable')
  await vi.waitFor(() => expect($('setup-next')!.hasAttribute('disabled')).toBe(false))
  await click('setup-next')
  await vi.waitFor(() => expect(stepShown()).toBe('project'))
  expect($('setup-next')!.hasAttribute('disabled')).toBe(true) // no project yet
})

it('resumes at the first step left, and Back goes through the steps in order', async () => {
  overview = { enabled: true, projects: [project('WEB', 'vibe')], templates: [], tasks: [] }
  await wizard()
  await vi.waitFor(() => expect(stepShown()).toBe('coordinator'))
  const order = []
  while (stepShown() !== 'enable') { await click('setup-back'); order.push(stepShown()) }
  expect(order).toEqual(['guards', 'workflow', 'project', 'enable'])
})

it('opens on the project asked, past the last step once all are done', async () => {
  overview = { enabled: true, projects: [project('API'), project('WEB', 'vibe')], templates: [], tasks: [task('WEB')] }
  coords = [{ project: 'WEB', terminal: 'host/t1' }]
  // Its pane not shown yet, then asking: step 5, with its answer button; running: done.
  await wizard({ project: 'WEB' })
  await vi.waitFor(() => expect(stepShown()).toBe('coordinator'))
  herdrState.value = { ok: true, panes: [coordPane('blocked')], workspaces: [] }
  await vi.waitFor(() => expect($('setup-open')).toBeTruthy())
  expect($('setup-next')!.hasAttribute('disabled')).toBe(true)
  mounted!.unmount()
  herdrState.value = { ok: true, panes: [coordPane('idle')], workspaces: [] }
  await wizard({ project: 'WEB' })
  await vi.waitFor(() => expect(stepShown()).toBe('done'))
  expect($('setup-complete')).toBeTruthy()
  mounted!.unmount()
  await wizard()
  await vi.waitFor(() => expect(stepShown()).toBe('workflow')) // API, the project with a step left
  // Its repository has no remote: an example that pushes is warned against, vibe offered.
  expect($('setup-no-remote')).toBeFalsy()
  document.querySelector<HTMLElement>('[data-example="github"]')!.click()
  await vi.waitFor(() => expect($('setup-no-remote')!.textContent).toContain('git remote add origin <url>'))
  await click('setup-use-vibe')
  await vi.waitFor(() => expect($('setup-no-remote')).toBeFalsy())
  expect($('setup-apply')!.textContent).toContain('Use vibe')
})

it('adding: opens at step 2 on a new project, added in place with its color, then shows its visibility', async () => {
  overview = { enabled: true, projects: [project('WEB', 'vibe')], templates: [], tasks: [] }
  await wizard({ adding: true })
  await vi.waitFor(() => expect($('setup-project-form')).toBeTruthy())
  expect(stepShown()).toBe('project')
  await vi.waitFor(() => expect($('setup-repos')).toBeTruthy())
  $('setup-repos')!.querySelector('button')!.click()
  await vi.waitFor(() => expect($('setup-add-project')!.hasAttribute('disabled')).toBe(false))
  await click('setup-add-project')
  await vi.waitFor(() => expect($('setup-visibility')).toBeTruthy())
  expect(added).toMatchObject({ key: 'WEB2', name: 'web', path: '/home/u/web', template: '', color: expect.any(String) })
  expect($('setup-next')!.hasAttribute('disabled')).toBe(false)
})

it('the board button counts the steps done, and is gone once a project is set up', async () => {
  overview = { enabled: true, projects: [project('WEB', 'vibe')], templates: [], tasks: [] }
  let w = await mountSuspended(SetupButton)
  mounted = w
  await vi.waitFor(() => expect(w.find('[data-testid="setup-button"]').text()).toContain('Finish setup (4/6)'))
  w.unmount()
  overview = { ...overview, tasks: [task('WEB')] }
  coords = [{ project: 'WEB', terminal: 'host/t1' }]
  w = await mountSuspended(SetupButton)
  mounted = w
  await new Promise(r => setTimeout(r, 50))
  expect(w.find('[data-testid="setup-button"]').exists()).toBe(false)
})
