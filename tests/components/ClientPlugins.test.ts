import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ClientPlugins from '~/components/ClientPlugins.vue'
import { clientPlugins } from '~/composables/useClientPlugins'

registerEndpoint('/api/client-plugins', () => ({ plugins: [] }))

it('says so when no plugin is installed', async () => {
  clientPlugins.value = []
  const w = await mountSuspended(ClientPlugins)
  expect(w.text()).toContain('No plugin installed')
})

it('lists a plugin disabled after an error with its message', async () => {
  const w = await mountSuspended(ClientPlugins)
  clientPlugins.value = [{ id: 'demo', name: 'Demo', version: '1.0', description: '', main: 'index.js', status: 'failed', error: 'boom' }]
  await nextTick()
  const li = w.find('[data-plugin="demo"]')
  expect(li.text()).toContain('Disabled after an error')
  expect(li.find('[role="alert"]').text()).toBe('boom')
})
