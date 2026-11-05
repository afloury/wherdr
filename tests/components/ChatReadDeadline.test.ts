import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import ChatView from '~/components/ChatView.vue'
import { useChatIntent } from '~/composables/useChatIntent'
import { cachedAt, eventsOpen, herdrState, locked, netDown } from '~/composables/useHerdr'
import type { Pane } from '#shared/types'

vi.mock('~/utils/offlineCache', () => ({ readChat: async () => null, saveChat: vi.fn(), touchChat: vi.fn() }))
const pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', agent: 'claude', status: 'idle', cwd: '/tmp/demo' } as Pane

afterEach(() => {
  eventsOpen.value = false
  herdrState.value = { ok: false, panes: [], workspaces: [] }
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

function clock() {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms)
    return controller.signal
  })
}

function reader() {
  locked.value = false; netDown.value = false; cachedAt.value = null
  herdrState.value = { ok: true, panes: [pane], workspaces: [] }
  let silent = false
  let aborted = false
  let text = 'Kept reply'
  vi.stubGlobal('fetch', vi.fn((path: string, opts?: RequestInit) => {
    if (!path.startsWith('/api/chat?')) return Promise.resolve(Response.json({}))
    if (silent) return new Promise<Response>((_resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => { aborted = true; reject(opts.signal!.reason) }, { once: true })
    })
    return Promise.resolve(Response.json({ available: true, file: 'fixture.jsonl', token: text, start: path.includes('before=') ? 0 : 4096, items: [{ role: 'assistant', text }] }))
  }))
  return { hang: () => { silent = true }, recover: () => { silent = false; text = 'Recovered reply' }, aborted: () => aborted }
}

it('releases a silent bottom read after 8 seconds so the next refresh can recover', async () => {
  const read = reader()
  const wrapper = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
  try {
    await expect.poll(() => wrapper.text()).toContain('Kept reply')
    clock(); read.hang()
    await wrapper.setProps({ pane: { ...pane, status: 'blocked' } })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(7999)
    expect(read.aborted()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(read.aborted()).toBe(true)
    expect(wrapper.text()).toContain('Kept reply')
    read.recover()
    await wrapper.setProps({ pane: { ...pane, status: 'working' } })
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(wrapper.text()).toContain('Recovered reply')
  } finally { wrapper.unmount() }
})

it('releases a silent older-page read so it can be retried', async () => {
  const read = reader()
  const wrapper = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
  try {
    await expect.poll(() => wrapper.text()).toContain('Kept reply')
    clock(); read.hang()
    const older = wrapper.find('.chat-more button')
    await older.trigger('click')
    await vi.advanceTimersByTimeAsync(7999)
    expect(read.aborted()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(read.aborted()).toBe(true)
    read.recover()
    await older.trigger('click')
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(wrapper.text()).toContain('Recovered reply')
    expect(wrapper.text()).toContain('Kept reply')
  } finally { wrapper.unmount() }
})

it('expires a silent speculative read without AbortSignal.any', async () => {
  const read = reader()
  clock(); read.hang()
  // iOS 16.4 has AbortSignal.timeout, but not AbortSignal.any.
  vi.stubGlobal('AbortSignal', { timeout: AbortSignal.timeout, any: undefined })
  eventsOpen.value = true
  const intent = useChatIntent()
  intent.preload(pane)
  const pending = intent.take(pane)
  await vi.advanceTimersByTimeAsync(7999)
  expect(read.aborted()).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(read.aborted()).toBe(true)
  expect(await pending).toBeUndefined()
})
