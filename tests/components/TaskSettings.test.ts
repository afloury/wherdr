import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { setResponseStatus } from 'h3'
import TaskSettings from '~/components/TaskSettings.vue'

let reads = 0
let fail = false
let reply: unknown = { settings: [], problems: [] }
let release: (() => void) | null = null
registerEndpoint('/api/tasks/settings', async (event) => {
  reads++
  if (release) await new Promise<void>(resolve => { release = resolve })
  if (fail) { setResponseStatus(event, 502); return { error: 'CLI unavailable' } }
  return reply
})
afterEach(() => { reads = 0; fail = false; release = null; reply = { settings: [], problems: [] } })

it('loads lazily, retains values and notes, and does not read again for the same target', async () => {
  reply = { settings: [
    { name: 'worker.agent', value: 'codex', place: 'repo', from: 'your entry for demo', note: 'Inherited' },
    { name: 'merge.pr', value: false, place: 'task', from: 'this task', note: 'Next run', later: 'After the current run' },
  ], problems: ['CLI warning'] }
  const w = await mountSuspended(TaskSettings, { props: { machine: 'remote', id: 'demo/1', active: false } })
  expect(reads).toBe(0)
  release = () => {}
  await w.setProps({ active: true })
  await flushPromises()
  expect(w.text()).toContain('Loading')
  await vi.waitFor(() => expect(reads).toBe(1))
  release!(); release = null
  await flushPromises()
  await vi.waitFor(() => expect(w.text()).toContain('your entry for demo'))
  expect(w.text()).toContain('false')
  expect(w.text()).toContain('Next run')
  expect(w.text()).toContain('After the current run')
  expect(w.find('[role="alert"]').text()).toContain('CLI warning')
  expect(w.findAll('input, select, textarea')).toHaveLength(0)
  await w.setProps({ active: false })
  await w.setProps({ active: true })
  await flushPromises()
  expect(reads).toBe(1)
  await w.setProps({ machine: 'another' })
  await flushPromises()
  expect(reads).toBe(2)
  w.unmount()
})
it('shows explicit errors with retry, absent data and offline state', async () => {
  fail = true
  const w = await mountSuspended(TaskSettings, { props: { machine: '', id: 'demo/1' } })
  await flushPromises()
  await vi.waitFor(() => expect(w.find('[role="alert"]').text()).toContain('CLI unavailable'))
  fail = false
  await w.get('button').trigger('click')
  await flushPromises()
  await vi.waitFor(() => expect(w.text()).toContain('No settings returned'))
  await w.setProps({ reachable: false, id: 'demo/2' })
  expect(w.text()).toContain('Machine offline')
  expect(reads).toBe(2)
  await w.setProps({ reachable: true })
  await flushPromises()
  expect(reads).toBe(3)
  w.unmount()
})

it('discards a late response after switching tasks', async () => {
  reply = { settings: [{ name: 'worker.agent', value: 'old-agent', place: 'task', from: 'this task' }], problems: [] }
  const w = await mountSuspended(TaskSettings, { props: { machine: '', id: 'demo/1', active: false } })
  release = () => {}
  await w.setProps({ active: true })
  await vi.waitFor(() => expect(reads).toBe(1))
  const oldResponse = release!
  await w.setProps({ id: 'demo/2', active: false })
  oldResponse(); release = null
  await flushPromises()
  expect(w.text()).not.toContain('old-agent')
  reply = { settings: [{ name: 'worker.agent', value: 'new-agent', place: 'repo', from: 'your entry for demo' }], problems: [] }
  await w.setProps({ active: true })
  await vi.waitFor(() => expect(w.text()).toContain('new-agent'))
  expect(w.text()).not.toContain('old-agent')
  w.unmount()
})
