import { afterEach, beforeAll, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SettingsView from '~/components/SettingsView.vue'

const global = { stubs: { UTooltip: { template: '<span><slot /></span>' } } }
let cfg: { core?: boolean }
let was: boolean | undefined
beforeAll(() => { cfg = useRuntimeConfig().public as { core?: boolean }; was = cfg.core })
afterEach(() => { cfg.core = was })

async function text(section: string, core: boolean) {
  cfg.core = core
  const w = await mountSuspended(SettingsView, { route: `/settings?section=${section}`, global })
  const t = w.text()
  w.unmount()
  return t
}

it('drops the Board wording in core mode, keeps it otherwise', async () => {
  const core = await text('appearance', true)
  expect(core).not.toMatch(/Board tasks|Tasks: one line/)
  expect(await text('appearance', false)).toMatch(/Board tasks stay grouped/)
})

it('shows the v3 version, no v2 update line, in core mode', async () => {
  const core = await text('about', true)
  expect(core).toContain('v3 · herdr-core')
  expect(core).not.toContain('latest version')
})
