import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { UApp } from '#components'
import ProjectPanel from '~/components/ProjectPanel.vue'
import type { ProjectBoard } from '#shared/projectBoard'

const board: ProjectBoard = {
  slug: 'acme',
  version: 'v1',
  lists: [
    { title: 'To test', kind: 'test', tasks: [{ text: 'Webhook retries', done: false, owner: 'me', thread: null }] },
    { title: 'In queue', kind: 'queue', tasks: [{ text: 'OpenAPI spec', done: false, owner: 'agent', thread: null }] },
  ],
  open: [],
  resolved: [],
}

describe('ProjectPanel', () => {
  // The board is already known when the panel mounts (cached from an earlier
  // opening, or answered before the first render): its lists show at once.
  it('mounts with a board already loaded', async () => {
    // Inside UApp, like in the app (its tooltips need the provider).
    const Host = defineComponent({ render: () => h(UApp, null, () => h(ProjectPanel, { paneId: 'w1:p1', board, loading: false, error: '' })) })
    const w = await mountSuspended(Host)
    expect(w.text()).toContain('Webhook retries')
    expect(w.text()).toContain('OpenAPI spec')
  })
})
