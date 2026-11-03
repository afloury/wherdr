import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useRouter } from '#app'
import SettingsView from '~/components/SettingsView.vue'

const global = { stubs: { UTooltip: { template: '<span><slot /></span>' } } }
let cfg: { core?: boolean }
let was: boolean | undefined
beforeAll(() => { cfg = useRuntimeConfig().public as { core?: boolean }; was = cfg.core })
afterEach(() => { cfg.core = was })

async function text(section: string, core: boolean) {
  cfg.core = core
  const route = `/settings?section=${section}`
  const w = await mountSuspended(SettingsView, { route, global })
  try {
    // On the phone layout, a direct entry slips Home underneath on mount
    // (replace('/') then push back). mountSuspended does not await that async
    // onMounted hook: wait for both navigations, or one finishes after teardown.
    const router = useRouter()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe(route)
      expect(typeof (history.state as { back?: unknown } | null)?.back).toBe('string')
    })
    return w.text()
  } finally {
    w.unmount()
  }
}

it('never shows the Board wording', async () => {
  expect(await text('appearance', true)).not.toMatch(/Board tasks|Tasks: one line/)
})

it('shows the v3 version, no v2 update line, in core mode', async () => {
  const core = await text('about', true)
  expect(core).toContain('v3 · herdr-core')
  expect(core).not.toContain('latest version')
})
