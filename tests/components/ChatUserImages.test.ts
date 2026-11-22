// A user message's photos and files show as the message field's square tiles
// (UChatAttachment) inside its bubble; a tap on a photo opens the viewer on
// the message's whole set, a file's name loses its stored date prefix.
import { afterEach, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ChatView from '~/components/ChatView.vue'
import { lightboxSet, lightboxSrc } from '~/composables/useUi'
import { herdrState } from '~/composables/useHerdr'
import type { ChatItem, Pane } from '#shared/types'

const pane: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null }
const path = '/home/user/.local/state/herdr-core/default/files/t1/2026-01-01T09-00-00-000Z-a1b2c3-report.pdf'
const items: ChatItem[] = [
  { role: 'user', text: `Here on my phone:\n${path}`, ts: '2026-01-01T09:00:00Z', ref: 'two', images: 2 },
  { role: 'assistant', text: 'Seen.', ts: '2026-01-01T09:00:05Z' },
]
registerEndpoint('/api/chat', () => ({ available: true, token: 'user-images', file: '/tmp/demo/transcript.jsonl', items }))

afterEach(() => { lightboxSrc.value = null; lightboxSet.value = []; herdrState.value = { ok: false, workspaces: [], panes: [] } })

it('shows a message\'s PDF and two photos as tiles, a tap opens the viewer', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [pane] }
  const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] }, global: { stubs: { UTooltip: { template: '<slot />' } } } })
  try {
    await expect.poll(() => w.findAll('.msg-user-wrap').length).toBe(1)
    const bubble = w.find('.msg-user-wrap .msg-bubble')
    // Photos then the file above the text, as tiles without a remove cross.
    expect(bubble.element.firstElementChild!.classList.contains('msg-media')).toBe(true)
    const photos = bubble.findAll('.msg-media .att-tile.has-photo')
    expect(photos).toHaveLength(2)
    expect(bubble.find('[data-slot="remove"]').exists()).toBe(false)
    // The file: its tile, original name, PDF badge; its path line is gone.
    const file = bubble.find('.msg-media .att-tile:not(.has-photo)')
    expect(file.find('[data-slot="name"]').text()).toBe('report.pdf')
    expect(file.find('.att-tile-badge').text()).toBe('PDF')
    expect(bubble.find('.msg-fold').text()).toBe('Here on my phone:')
    expect(bubble.text()).not.toContain('herdr-core')
    // A tap on the second photo opens the viewer on both.
    const srcs = photos.map(p => p.find('img').attributes('src'))
    await photos[1]!.trigger('click')
    expect(lightboxSet.value).toEqual(srcs)
    expect(lightboxSrc.value).toBe(srcs[1])
  } finally { w.unmount() }
})
