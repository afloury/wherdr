import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ChatView from '~/components/ChatView.vue'
import { lightboxSet, lightboxSrc } from '~/composables/useUi'
import { herdrState } from '~/composables/useHerdr'
import type { ChatItem, Pane } from '#shared/types'

const pane: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'omp', name: null, label: null, status: 'blocked', title: null, cwd: '/tmp/demo', agentSession: null }
let items: ChatItem[] = []
registerEndpoint('/api/chat', () => ({ available: true, token: 'rendering', file: '/tmp/demo/transcript.jsonl', items }))

describe('conversation rendering', () => {
  afterEach(() => { lightboxSrc.value = null; lightboxSet.value = []; herdrState.value = { ok: false, workspaces: [], panes: [] } })

  it('keeps an action awaiting approval live without a finished-turn line', async () => {
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    items = [
      { role: 'user', text: 'Clean the build folder.', ts: '2026-01-01T00:00:00Z' },
      // Pending omp calls already carry their console view before any tool result.
      { role: 'tool', text: 'rm -rf build', name: 'Bash', ts: '2026-01-01T00:00:01Z', omp: { title: 'Bash', target: 'rm -rf build', intent: 'Removing the build folder' } },
    ]
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.chat').text()).toContain('Clean the build folder.')
      const message = w.find('.msg-user .msg-fold')
      expect(message.element.textContent).toBe('Clean the build folder.')
      expect(message.isVisible()).toBe(true)
      expect(w.find('.tools.omp-console.live').isVisible()).toBe(true)
      expect(w.find('.omp-console .omp-tool-cmd').text()).toBe('rm -rf build')
      expect(w.findAll('.turn-end')).toHaveLength(0)
    } finally { w.unmount() }
  })

  it('keeps a folded omp tool image outside the hidden calls and opens its viewer', async () => {
    const idle = { ...pane, status: 'idle' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [idle] }
    items = [
      { role: 'tool', text: '', ts: '2026-01-01T00:00:00Z', ref: 'image-line', images: 1, omp: { title: 'Read', target: 'login.png' } },
      ...['ls', 'git status', 'npm test'].map((target, i): ChatItem => ({ role: 'tool', text: '', ts: `2026-01-01T00:00:0${i + 1}Z`, omp: { title: 'Bash', target, out: 'ok' } })),
      { role: 'assistant', text: 'The login button is clipped.', ts: '2026-01-01T00:00:04Z' },
    ]
    const w = await mountSuspended(ChatView, { props: { pane: idle, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.chat').text()).toContain('The login button is clipped.')
      const consoleBlock = w.find('.omp-console')
      expect(consoleBlock.find('.omp-console-more').isVisible()).toBe(true)
      expect(consoleBlock.findAll('.omp-tool')).toHaveLength(3)
      expect(consoleBlock.text()).not.toContain('read login.png')
      const thumbs = consoleBlock.findAll('.tool-thumbs .msg-img')
      expect(thumbs).toHaveLength(1)
      const src = thumbs[0]!.attributes('src')!
      expect(src).toMatch(/^\/api\/chat\/image\?pane=/)
      await thumbs[0]!.trigger('click')
      expect(lightboxSrc.value).toBe(src)
      expect(lightboxSet.value).toEqual([src])
    } finally { w.unmount() }
  })
  it('keeps a scheduled prompt folded while rendering its Markdown on demand', async () => {
    const idle = { ...pane, status: 'idle' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [idle] }
    items = [
      { role: 'notice', name: 'scheduled', text: '**Check deployment**', ts: '2026-01-01T00:00:00Z' },
      { role: 'assistant', text: 'Deployment is green.', ts: '2026-01-01T00:00:01Z' },
    ]
    const w = await mountSuspended(ChatView, {
      props: { pane: idle, localQueued: [] },
      global: { stubs: { UTooltip: { template: '<slot />' } } },
    })
    try {
      await expect.poll(() => w.find('.chat').text()).toContain('Deployment is green.')
      const notice = w.find('.msg-notice.scheduled')
      expect(notice.classes()).toContain('long')
      expect(notice.classes()).not.toContain('open')
      expect(notice.find('.msg-notice-body strong').text()).toBe('Check deployment')
      expect(w.findAll('.msg-user-wrap')).toHaveLength(0)
      const toggle = notice.find('button.msg-shell-more')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      await toggle.trigger('click')
      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect(notice.classes()).toContain('open')
    } finally { w.unmount() }
  })

})
