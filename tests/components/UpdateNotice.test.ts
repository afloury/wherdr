import { expect, it } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { dismissUpdate, loadUpdate, updateBanner, updateInfo } from '~/composables/useUpdate'

let reads = 0
registerEndpoint('/api/update', () => { reads++; return { latest: '9.9.9', current: '9.9.8' } })

it('keeps a hidden version hidden when revisiting Home or Settings', async () => {
  localStorage.removeItem('wherdr.update.dismissed')
  loadUpdate()
  await expect.poll(() => updateInfo.value?.latest).toBe('9.9.9')
  expect(updateBanner.value?.latest).toBe('9.9.9')
  dismissUpdate()
  expect(localStorage.getItem('wherdr.update.dismissed')).toBe('9.9.9')
  loadUpdate()
  loadUpdate()
  expect(reads).toBe(1)
  expect(updateBanner.value).toBeNull()
  updateInfo.value = { ...updateInfo.value!, latest: '9.9.10' }
  expect(updateBanner.value?.latest).toBe('9.9.10')
  localStorage.removeItem('wherdr.update.dismissed')
})
