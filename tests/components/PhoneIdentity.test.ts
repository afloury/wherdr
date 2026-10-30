import { afterEach, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PhoneIdentity from '~/components/PhoneIdentity.vue'
import { herdrState } from '~/composables/useHerdr'
import type { Pane } from '#shared/types'

const pane: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'omp', name: 'build review', label: null, status: 'idle', title: '', cwd: '/', agentSession: null }
afterEach(() => { herdrState.value = { ok: false, panes: [], workspaces: [] } })
it('uses the pane name and the app state square in its two-line identity', async () => {
  herdrState.value = { ok: true, panes: [pane], workspaces: [] }
  const wrapper = await mountSuspended(PhoneIdentity, { props: { pane } })
  try {
    expect(wrapper.find('.phone-identity-title').text()).toBe('build review')
    expect(wrapper.find('.phone-identity-meta .pill.idle i').exists()).toBe(true)
    expect(wrapper.find('.phone-identity-kind').text()).toBe('omp')
    expect(wrapper.find('[class*=circle]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'AppSheet' }).props('hideClose')).toBe(true)
    await wrapper.setProps({ pane: { ...pane, agent: null } })
    expect(wrapper.find('.phone-identity-meta').text()).toBe('Shell')
    expect(wrapper.find('.phone-identity-kind').exists()).toBe(false)
  } finally { wrapper.unmount() }
})
