import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ClientPlugins from '~/components/ClientPlugins.vue'
import { clientPlugins, communityPlugins } from '~/composables/useClientPlugins'
import { answerConfirm, confirmState } from '~/composables/useUi'

registerEndpoint('/api/client-plugins', () => ({ plugins: [], enabled: false }))

it('says so when no plugin is installed', async () => {
  clientPlugins.value = []
  const w = await mountSuspended(ClientPlugins)
  expect(w.text()).toContain('No plugin installed')
})

it('turns Community plugins on only after the full-access warning', async () => {
  const w = await mountSuspended(ClientPlugins)
  communityPlugins.value = false
  const sw = () => w.find('[data-wherdr="community-plugins"] [role="switch"]')
  await sw().trigger('click')
  await vi.waitFor(() => expect(confirmState.open).toBe(true))
  expect(confirmState.message).toContain('full access')
  expect(confirmState.action).toBe('Turn on')
  answerConfirm(false)
  await nextTick()
  expect(communityPlugins.value).toBe(false)
  await sw().trigger('click')
  await vi.waitFor(() => expect(confirmState.open).toBe(true))
  answerConfirm(true)
  await vi.waitFor(() => expect(communityPlugins.value).toBe(true))
})

it('lists a plugin disabled after an error with its message', async () => {
  const w = await mountSuspended(ClientPlugins)
  clientPlugins.value = [{ id: 'demo', name: 'Demo', version: '1.0', description: '', main: 'index.js', status: 'failed', error: 'boom' }]
  await nextTick()
  const li = w.find('[data-plugin="demo"]')
  expect(li.text()).toContain('Disabled after an error')
  expect(li.find('[role="alert"]').text()).toBe('boom')
})
