// Coming back to the app re-reads the conversation's bottom at once (the
// events socket returning re-reads instead of waiting out the poll), but a
// re-read that changed nothing must leave the view exactly as it is: same
// tail, same items, same blocks and DOM nodes, no Markdown re-render, no
// scroll write — only the token the next request sends advances.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import ChatView from '~/components/ChatView.vue'
import { cachedAt, eventsOpen, herdrState, netDown, pageVisible, reducedMotion } from '~/composables/useHerdr'
import type { ChatItem, ChatResponse, Pane } from '#shared/types'

// Markdown render calls (utils/markdown.ts): the equal re-read must not ask
// for one — the blocks that would call it are left untouched.
const calls = vi.hoisted(() => ({ md: 0 }))
vi.mock('~/utils/markdown', async (importOriginal) => {
  const mod = await importOriginal<typeof import('~/utils/markdown')>()
  return { ...mod, md: (text: string, opts?: Parameters<typeof mod.md>[1]) => { calls.md++; return mod.md(text, opts) } }
})

// What each read asked for, and what the next one answers (set per test).
const asks: Record<string, string>[] = []
let reply: (q: Record<string, string>) => ChatResponse | Promise<ChatResponse> = () => ({ available: false, reason: 'not_found' })
registerEndpoint('/api/chat', (event) => {
  const q = Object.fromEntries(new URL(event.node.req.url || '', 'http://x').searchParams)
  asks.push(q)
  return reply(q)
})

const FILE = '/tmp/demo/transcript.jsonl'
const ITEMS: ChatItem[] = [
  { role: 'user', text: 'Add a resume step.', ts: '2026-01-01T00:00:00Z' },
  { role: 'tool', name: 'Bash', text: 'npm test', ts: '2026-01-01T00:00:01Z' },
  { role: 'assistant', text: 'The re-read now keeps **equal** items.', ts: '2026-01-01T00:00:02Z' },
]
const pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null } as Pane

// The component's own state, through the dev bindings (chat, items, blocks,
// loadChat): what a re-read would have rebuilt is asserted by identity.
interface View {
  chat: { file: string | null, token: string, tailStart: number | null, tail: ChatItem[], queue: unknown[] }
  items: ChatItem[]
  blocks: { key: string }[]
  loadChat: () => Promise<void>
}
const view = (w: VueWrapper): View => (w.vm as unknown as { $: { setupState: View } }).$.setupState

// scrollTop writes on the scroll box: apply() re-pins to the bottom through
// requestAnimationFrame; the no-op path must not.
function scrollWrites(el: Element) {
  let n = 0
  let v = (el as HTMLElement).scrollTop
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => v,
    set: (x) => { n++; v = x },
  })
  return () => n
}
// Let the rAF of a scrollToEnd run, when there is one.
const settle = () => new Promise(r => setTimeout(r, 80))
const rendered = (w: VueWrapper) => [...(w.find('.chat-list').element.children)]
const sameNodes = (a: Element[], b: Element[]) => a.length === b.length && a.every((el, i) => el === b[i])

// UTooltip needs the app's TooltipProvider: the end-of-turn copy button is
// not what is tested here.
const mountOptions = { props: { pane, localQueued: [] }, global: { stubs: { UTooltip: { template: '<slot />' } } } }
async function mount() {
  herdrState.value = { ok: true, workspaces: [], panes: [pane] }
  const w = await mountSuspended(ChatView, mountOptions)
  await expect.poll(() => w.find('.chat').text()).toContain('keeps')
  await settle() // the first paint's own scrollToEnd rAF fires here, not in a test
  return w
}

describe('re-read that keeps the current blocks', () => {
  afterEach(() => {
    asks.length = 0
    reply = () => ({ available: false, reason: 'not_found' })
    herdrState.value = { ok: false, workspaces: [], panes: [] }
    eventsOpen.value = false
    netDown.value = false
    cachedAt.value = null
    pageVisible.value = true
    reducedMotion.value = false
  })

  it('an equal answer keeps tail, items, blocks and nodes, and only the token advances', async () => {
    let token = 'tok-1'
    reply = () => ({ available: true, file: FILE, token, start: 0, items: structuredClone(ITEMS) })
    const w = await mount()
    const v = view(w)
    try {
      const tail = v.chat.tail
      const itemObjects = [...tail]
      const items = v.items
      const blocks = v.blocks
      const nodes = rendered(w)
      const writes = scrollWrites(w.find('.chat').element)
      const mdBefore = calls.md

      // Same bottom, cloned: new objects, same content, only the token differs.
      token = 'tok-2'
      await v.loadChat()
      await expect.poll(() => asks.length).toBeGreaterThanOrEqual(2)
      await settle()

      expect(v.chat.tail).toBe(tail)
      expect(v.chat.tail.every((it, i) => it === itemObjects[i])).toBe(true)
      expect(v.items).toBe(items)
      expect(v.blocks).toBe(blocks)
      expect(sameNodes(rendered(w), nodes)).toBe(true)
      expect(writes()).toBe(0)
      expect(calls.md).toBe(mdBefore)
      expect(v.chat.token).toBe('tok-2')

      // And the next read asks from the new token.
      await v.loadChat()
      await expect.poll(() => asks.at(-1)!.since === 'tok-2').toBe(true)
    } finally { w.unmount() }
  })

  it('a metadata-only delta (keep: N, items: []) re-renders nothing and writes no scroll', async () => {
    let token = 'tok-1'
    reply = () => ({ available: true, file: FILE, token, start: 0, items: structuredClone(ITEMS) })
    const w = await mount()
    const v = view(w)
    try {
      const tail = v.chat.tail
      const blocks = v.blocks
      const nodes = rendered(w)
      const writes = scrollWrites(w.find('.chat').element)
      const mdBefore = calls.md

      // The file grew only by lines that are not items: same list, new token.
      token = 'tok-2'
      reply = (q) => (q.since === 'tok-1'
        ? { available: true, file: FILE, token: 'tok-2', keep: ITEMS.length, items: [] }
        : { available: true, file: FILE, token, start: 0, items: structuredClone(ITEMS) })
      await v.loadChat()
      await expect.poll(() => asks.some(a => a.since === 'tok-1')).toBe(true)
      await settle()

      expect(v.chat.tail).toBe(tail)
      expect(v.blocks).toBe(blocks)
      expect(sameNodes(rendered(w), nodes)).toBe(true)
      expect(writes()).toBe(0)
      expect(calls.md).toBe(mdBefore)
      expect(v.chat.token).toBe('tok-2')
    } finally { w.unmount() }
  })

  it('a changed item renders its new text while the earlier blocks keep their nodes', async () => {
    reducedMotion.value = true // no typewriter: the new reply is whole at once
    const changed = structuredClone(ITEMS)
    changed[2] = { ...changed[2]!, text: 'The re-read was rebuilt where it changed.', ts: '2026-01-01T00:00:09Z' }
    let next: ChatItem[] | null = null
    reply = () => ({ available: true, file: FILE, token: 'tok-2', start: 0, items: next ? structuredClone(next) : structuredClone(ITEMS) })
    const w = await mount()
    const v = view(w)
    try {
      const tail = v.chat.tail
      const nodes = rendered(w)

      next = changed
      await v.loadChat()
      await expect.poll(() => w.find('.chat').text()).toContain('rebuilt where it changed')

      expect(v.chat.tail).not.toBe(tail)
      expect(v.chat.tail[0]).toBe(tail[0])
      expect(v.chat.tail[1]).toBe(tail[1])
      expect(v.chat.tail[2]).not.toBe(tail[2])
      const after = rendered(w)
      // The changed reply's key moved; the blocks before it keep their nodes.
      expect(after.length).toBe(nodes.length)
      expect(after.slice(0, 3).every((el, i) => el === nodes[i])).toBe(true)
      expect(after[3]).not.toBe(nodes[3])
    } finally { w.unmount() }
  })

  it('the events socket returning drops a black-holed read and asks again at once', async () => {
    const pending: Array<() => void> = []
    reply = () => (asks.length === 1
      // The first read never answers (a request outliving a suspend): it
      // holds the one-at-a-time lock until something drops it.
      ? new Promise<ChatResponse>((resolve) => pending.push(() => resolve({ available: false, reason: 'not_found' })))
      : Promise.resolve({ available: true, file: FILE, token: 'tok-2', start: 0, items: structuredClone(ITEMS) }))
    const w = await mountSuspended(ChatView, mountOptions)
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    try {
      await expect.poll(() => asks.length).toBe(1) // the first read is in flight, unanswered
      // The socket comes back: the held read is dropped and a new one starts.
      eventsOpen.value = true
      await expect.poll(() => asks.length).toBeGreaterThanOrEqual(2)
      await expect.poll(() => w.find('.chat').text()).toContain('keeps')
    } finally {
      pending.forEach(r => r())
      eventsOpen.value = false
      w.unmount()
    }
  })
})
