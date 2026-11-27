import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import AgentView from '~/components/AgentView.vue'
import { curPane, herdrState } from '~/composables/useHerdr'
import { useDraft } from '~/composables/useDraft'
import { createAppPluginDeps } from '~/composables/useClientPlugins'
import { answerConfirm, askConfirm } from '~/composables/useUi'
import { createPluginHost, type WherdrApi } from '~/utils/pluginHost'
import type { Pane } from '#shared/types'

const pane: Pane = { id: 'w1:p7', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/home/user/demo', agentSession: null }
const sentPrompts: unknown[] = []
registerEndpoint('/api/chat', () => ({ available: true, token: 't', file: '/home/user/demo/t.jsonl', start: 0, items: [] }))
registerEndpoint('/api/prompt', { method: 'POST', handler: (e) => { sentPrompts.push(e); return { ok: true } } })
registerEndpoint('/api/client-plugins', () => ({ plugins: [], enabled: false }))

const pass = { template: '<div><slot /></div>' }

describe('plugin draft wiring', () => {
  beforeEach(() => {
    herdrState.value = { ok: true, workspaces: [{ id: 'w1', number: 1, label: 'Demo', focused: false }], panes: [pane] } as never
  })
  afterEach(() => {
    curPane.value = null
    herdrState.value = { ok: false, workspaces: [], panes: [] }
    useDraft(pane.id).text = ''
  })

  it('draft.get/set/focus read, fill and focus the open composer, never send, never steal a window’s focus', async () => {
    sentPrompts.length = 0
    let api!: WherdrApi
    let prefs = { off: [] as string[], failed: {} as Record<string, string> }
    const host = createPluginHost(createAppPluginDeps(() => {}, {
      list: async () => ({ plugins: [{ id: 'demo', name: 'Demo', version: '1', description: '', main: 'index.js' }], enabled: true }),
      load: async () => ({ default: (w: WherdrApi) => { api = w } }),
      prefs: () => prefs,
      savePrefs: (p) => { prefs = p },
    }))
    await host.init()

    // No conversation open: draft.get is null, set and focus are no-ops.
    curPane.value = null
    expect(api.draft.get()).toBeNull()
    api.draft.set('ignored')
    api.draft.focus()

    const w = await mountSuspended(AgentView, { props: { paneId: pane.id }, route: `/a/${pane.id}`, attachTo: document.body, global: { stubs: { UTooltip: pass } } })
    try {
      await nextTick()
      const ta = w.find<HTMLTextAreaElement>('.composer textarea').element
      expect(api.draft.get()).toBe('')

      api.draft.set('Check the build logs.')
      await nextTick()
      expect(ta.value).toBe('Check the build logs.')
      expect(api.draft.get()).toBe('Check the build logs.')

      expect(document.activeElement).not.toBe(ta)
      api.draft.focus()
      expect(document.activeElement).toBe(ta)

      // An open window keeps its focus: the composer is not focused.
      ta.blur()
      const asked = askConfirm('Remove the plugin?', 'Remove')
      api.draft.focus()
      expect(document.activeElement).not.toBe(ta)
      answerConfirm(false)
      await asked
      api.draft.focus()
      expect(document.activeElement).toBe(ta)

      // Nothing was ever sent.
      expect(sentPrompts).toHaveLength(0)
    } finally {
      w.unmount()
      await host.setCommunity(false)
    }
  })
})
