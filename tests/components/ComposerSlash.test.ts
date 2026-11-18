import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Composer from '~/components/Composer.vue'
import { eventsOpen } from '~/composables/useHerdr'
import { menuState } from '~/composables/useUi'
import type { MenuItem } from '~/composables/useUi'
import type { Pane } from '#shared/types'

const pane = (id: string, agent: string): Pane => ({
  id, workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent, name: null, label: null, status: 'idle', title: null, cwd: '/home/user/acme-shop', agentSession: null,
})

const commands = () => menuState.items.filter((i: MenuItem) => i.kind === 'command')

async function openPlus(agent: string) {
  const p = pane(`w1:${agent}`, agent)
  const w = await mountSuspended(Composer, { props: { pane: p, paneId: p.id, sendKeys: async () => {} } })
  await w.find('[aria-label="Photo, file, paste, commands"]').trigger('click')
  return p
}

describe('Composer + menu: the agent’s slash commands', () => {
  beforeEach(() => { eventsOpen.value = true })
  afterEach(() => { eventsOpen.value = false; menuState.open = false; menuState.items = [] })

  // Antigravity CLI 1.5.9: each one runs from a paste + Enter; the panels
  // (context, usage, diff, model) open the interactive terminal (see
  // core-screen-fixtures.test.ts). First mount of the file: a cold Nuxt
  // environment, hence the longer timeout.
  it('offers Antigravity’s commands after Interrupt', { timeout: 40000 }, async () => {
    await openPlus('agy')
    expect(commands().map(c => [c.cmd, c.desc])).toEqual([
      ['esc', 'Interrupt agent'],
      ['/compact', 'Summarize context'],
      ['/clear', 'New conversation'],
      ['/context', 'Context usage'],
      ['/usage', 'Plan usage'],
      ['/model', 'Change model'],
      ['/diff', 'View diff'],
    ])
  })
})
