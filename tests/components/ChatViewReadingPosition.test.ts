// Back to a conversation read further up: it reopens at the same place on the
// first paint (the copy kept on this device included) and the network's answer
// moves nothing; a position restored while the skeleton still hides the blocks
// would measure an empty list and land at the top.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ChatView from '~/components/ChatView.vue'
import { herdrState } from '~/composables/useHerdr'
import { ACCESS_KEY } from '~/utils/offlineAccess'
import { saveReadingPosition } from '~/utils/readingPosition'
import type { SavedChat } from '~/utils/offlineCache'
import type { ChatItem, ChatResponse, Pane } from '#shared/types'

const kept = vi.hoisted(() => ({ chat: null as SavedChat | null }))
vi.mock('~/utils/offlineCache', async (importOriginal) => {
  const mod = await importOriginal<typeof import('~/utils/offlineCache')>()
  return { ...mod, readChat: async () => kept.chat, saveChat: () => {}, touchChat: () => {} }
})

// The network's answer waits until the test lets it go.
let release: () => void = () => {}
let asked = 0
registerEndpoint('/api/chat', async () => {
  asked++
  await new Promise<void>((r) => { release = r })
  return { available: true, file: FILE, token: 't1', start: 0, items: structuredClone(ITEMS) } satisfies ChatResponse
})

const FILE = '/tmp/demo/transcript.jsonl'
const ITEMS: ChatItem[] = Array.from({ length: 16 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user', text: `Message ${i}`, ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
}))
const pane = { id: 'w1:p9', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null } as Pane
const FROM_BOTTOM = 1700 // 1200 px above the end, with a 500 px high box

// Layout for the scroll box: 200 px per rendered child of the list; every
// scrollTop write recorded as its distance from the bottom at that moment.
const tops = new WeakMap<Element, number>()
let fromBottomWrites: number[] = []
const height = (el: Element) => (el.querySelector('.chat-list')?.children.length || 0) * 200 + 500
const raf: FrameRequestCallback[] = []
async function flushFrames() {
  while (raf.length) {
    for (const cb of raf.splice(0)) cb(0)
    await nextTick()
  }
}
const box = (w: VueWrapper) => w.find('.chat').element
const fromBottom = (w: VueWrapper) => height(box(w)) - box(w).scrollTop

async function mount() {
  herdrState.value = { ok: true, workspaces: [], panes: [pane] }
  return mountSuspended(ChatView, { props: { pane, localQueued: [] }, global: { stubs: { UTooltip: { template: '<slot />' } } } })
}

describe('reading position on return', () => {
  beforeEach(() => {
    const proto = HTMLElement.prototype
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return this.classList.contains('chat') ? height(this) : 0 } })
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return this.classList.contains('chat') ? 500 : 0 } })
    Object.defineProperty(proto, 'scrollTop', {
      configurable: true,
      get() { return tops.get(this) || 0 },
      set(v: number) { tops.set(this, v); if (this.classList.contains('chat')) fromBottomWrites.push(height(this) - v) },
    })
    fromBottomWrites = []
    raf.length = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { raf.push(cb); return raf.length })
    vi.stubGlobal('setInterval', () => 0)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    localStorage.setItem(ACCESS_KEY, JSON.stringify({ enabled: false, expiresAt: 0 }))
    saveReadingPosition(pane.id, FILE, { scrollTop: 10000 - FROM_BOTTOM, scrollHeight: 10000, clientHeight: 500 })
  })
  afterEach(() => {
    release()
    kept.chat = null
    asked = 0
    herdrState.value = { ok: false, workspaces: [], panes: [] }
    localStorage.removeItem(ACCESS_KEY)
    for (const k of ['scrollHeight', 'clientHeight', 'scrollTop']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k]
    vi.unstubAllGlobals()
  })

  it('restores the kept copy at the position, and the network answer moves nothing', async () => {
    kept.chat = { id: pane.id, items: structuredClone(ITEMS), at: Date.now() - 60_000, file: FILE }
    const w = await mount()
    try {
      await expect.poll(() => w.find('.chat').text()).toContain('Message 15')
      await flushFrames()
      expect(height(box(w))).toBeGreaterThan(FROM_BOTTOM + 500)
      expect(fromBottom(w)).toBe(FROM_BOTTOM)
      await expect.poll(() => asked).toBe(1)
      const writes = fromBottomWrites.length
      release()
      await expect.poll(() => (w.vm as unknown as { $: { setupState: { savedAt: number | null } } }).$.setupState.savedAt).toBeNull()
      await new Promise(r => setTimeout(r, 50))
      await flushFrames()
      expect(fromBottom(w)).toBe(FROM_BOTTOM)
      expect(fromBottomWrites.slice(writes).every(d => d === FROM_BOTTOM)).toBe(true)
    } finally { w.unmount() }
  })

  it('restores the position, not the top, when the answer comes while the skeleton shows', async () => {
    const w = await mount()
    try {
      await expect.poll(() => w.find('.chat-list.skeleton').exists(), { timeout: 2000 }).toBe(true)
      await expect.poll(() => asked).toBe(1)
      release()
      await expect.poll(() => w.find('.chat-list.skeleton').exists(), { timeout: 2000 }).toBe(false)
      await expect.poll(() => fromBottomWrites.length).toBeGreaterThan(0)
      await flushFrames()
      expect(box(w).scrollTop).toBeGreaterThan(0)
      expect(fromBottom(w)).toBe(FROM_BOTTOM)
      expect(fromBottomWrites.every(d => d === FROM_BOTTOM)).toBe(true)
    } finally { w.unmount() }
  })
})
