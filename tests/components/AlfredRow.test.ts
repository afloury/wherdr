// WHR-403: Alfred's row at the top of the agent list: not started (the first
// tap asks for its agent), running (its agent shown), renamed (identity.md's name).
import { afterEach, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import AlfredRow from '~/components/AlfredRow.vue'
import { herdrState } from '~/composables/useHerdr'
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
afterEach(() => { w?.unmount(); w = null; posts.length = 0; navigate.mockReset(); document.body.innerHTML = '' })
const mount = async () => {
  w = await mountSuspended(AlfredRow, { attachTo: document.body })
  await vi.waitFor(() => expect(w!.find('[data-testid="alfred-name"]').text()).toBe(String(view.name)))
  return w
}

it('not started, no agent yet: a greyed row, and the first tap asks which agent, then starts it', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [] }
  view = { name: 'Alfred' }
  await mount()
  expect(w!.find('[data-testid="alfred"]').classes()).not.toContain('on')
  expect(w!.find('[data-testid="alfred-sub"]').text()).toBe('not started')
  expect(w!.find('[data-testid="alfred-open"]').text()).toContain('Start')
  await w!.find('[data-testid="alfred-open"]').trigger('click')
  await vi.waitFor(() => expect(document.querySelector('[data-testid="alfred-sheet"]')).not.toBeNull())
  expect(posts).toEqual([])
  ;(document.querySelector('[data-agent="codex:gpt-6-sol"]') as HTMLElement).click()
  ;(document.querySelector('[data-testid="alfred-start"]') as HTMLElement).click()
  await vi.waitFor(() => expect(posts).toEqual([{ project: MAIN, program: 'codex', model: 'gpt-6-sol' }]))
})

it('not started with a remembered agent: one tap starts it with that agent', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [] }
  view = { name: 'Alfred', agent: { program: 'claude', model: 'sonnet' } }
  await mount()
  await vi.waitFor(() => expect(w!.find('[data-testid="alfred-sub"]').text()).toBe('not started · Claude Sonnet'))
  await w!.find('[data-testid="alfred-open"]').trigger('click')
  await vi.waitFor(() => expect(posts).toEqual([{ project: MAIN, program: 'claude', model: 'sonnet' }]))
})

it('running and renamed: its name, its current agent, one tap opens the conversation', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [pane('w:p1', 'host/t1')] }
  view = { name: 'Jeeves', agent: { program: 'claude', model: 'opus' }, ran: { program: 'claude', model: 'opus' }, terminal: 'host/t1' }
  await mount()
  expect(w!.find('[data-testid="alfred"]').classes()).toContain('on')
  expect(w!.find('[data-testid="alfred-sub"]').text()).toMatch(/^Claude Opus · /)
  await w!.find('[data-testid="alfred-open"]').trigger('click')
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/a/w%3Ap1'))
  expect(posts).toEqual([])
})
