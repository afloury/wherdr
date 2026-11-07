// WHR-403: Alfred's row at the top of the agent list: not started (the first
// tap asks for its agent), running (its agent shown), renamed (identity.md's name).
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import AlfredRow from '~/components/AlfredRow.vue'
import { agentOrder, appConfig, herdrState, hiddenAgents } from '~/composables/useHerdr'
import { MAIN } from '#shared/pm/coordinator'
import type { Pane } from '#shared/types'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)

const posts: unknown[] = []
let view: Record<string, unknown> = {}
registerEndpoint('/api/alfred', () => view)
registerEndpoint('/api/pm/coordinators', () => [])
registerEndpoint('/api/pm/coordinator-start', { method: 'POST', handler: async (e) => { posts.push(await readBody(e)); return { terminal: 'host/t9' } } })

const pane = (id: string, coreAddress: string) => ({ id, coreAddress, status: 'idle', agent: 'claude', workspace: 'w', tab: 't' }) as Pane
let w: Awaited<ReturnType<typeof mountSuspended>> | null = null
afterEach(() => { w?.unmount(); w = null; posts.length = 0; hiddenAgents.value = []; agentOrder.value = []; navigate.mockReset(); document.body.innerHTML = '' })
const mount = async (props: { banner?: boolean } = {}) => {
  w = await mountSuspended(AlfredRow, { attachTo: document.body, props })
  await vi.waitFor(() => expect(w!.find('[data-testid="alfred-name"]').text()).toBe(String(view.name)))
  return w
}

it('not started, no agent yet: a greyed row, and the first tap asks which offered program (Settings › Agents), then starts it', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [] }
  // Gemini unchecked, Codex first; Cline cannot carry Alfred.
  appConfig.value = { ...appConfig.value, kinds: ['claude', 'gemini', 'cline', 'codex'] }
  hiddenAgents.value = ['gemini']
  agentOrder.value = ['codex']
  view = { name: 'Alfred' }
  await mount()
  expect(w!.find('[data-testid="alfred"]').classes()).not.toContain('on')
  expect(w!.find('[data-testid="alfred-sub"]').text()).toBe('not started')
  expect(w!.find('[data-testid="alfred-open"]').text()).toContain('Start')
  await w!.find('[data-testid="alfred-open"]').trigger('click')
  await vi.waitFor(() => expect(document.querySelector('[data-testid="alfred-sheet"]')).not.toBeNull())
  expect(posts).toEqual([])
  // One tile per offered program, in the user's order, no models; the first picked.
  expect([...document.querySelectorAll('[data-agent]')].map(b => b.textContent!.trim())).toEqual(['Codex', 'Claude'])
  expect(document.querySelector('[data-agent="codex"]')!.getAttribute('aria-checked')).toBe('true')
  ;(document.querySelector('[data-agent="claude"]') as HTMLElement).click()
  await nextTick()
  ;(document.querySelector('[data-testid="alfred-start"]') as HTMLElement).click()
  await vi.waitFor(() => expect(posts).toEqual([{ project: MAIN, program: 'claude' }]))
})

it('not started with a remembered agent: one tap starts it with that agent', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [] }
  view = { name: 'Alfred', program: 'claude' }
  await mount()
  await vi.waitFor(() => expect(w!.find('[data-testid="alfred-sub"]').text()).toBe('not started · Claude'))
  await w!.find('[data-testid="alfred-open"]').trigger('click')
  await vi.waitFor(() => expect(posts).toEqual([{ project: MAIN, program: 'claude' }]))
})

it('as the board\'s All projects banner: the same one tap, no ••• menu', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [] }
  view = { name: 'Alfred', program: 'claude' }
  await mount({ banner: true })
  await vi.waitFor(() => expect(w!.find('[data-testid="alfred-sub"]').text()).toBe('All projects · not started · Claude'))
  expect(w!.find('[data-testid="alfred-more"]').exists()).toBe(false)
  await w!.find('[data-testid="alfred-open"]').trigger('click')
  await vi.waitFor(() => expect(posts).toEqual([{ project: MAIN, program: 'claude' }]))
})

it('running and renamed: its name, its current agent, one tap opens the conversation', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [pane('w:p1', 'host/t1')] }
  view = { name: 'Jeeves', program: 'claude', ran: 'claude', terminal: 'host/t1' }
  await mount()
  expect(w!.find('[data-testid="alfred"]').classes()).toContain('on')
  expect(w!.find('[data-testid="alfred-sub"]').text()).toMatch(/^Claude · /)
  await w!.find('[data-testid="alfred-open"]').trigger('click')
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/a/w%3Ap1'))
  expect(posts).toEqual([])
})
