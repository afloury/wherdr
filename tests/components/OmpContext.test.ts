import { expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Pane } from '../../shared/types'
import OmpContext from '~/components/OmpContext.vue'

it('keeps context details behind the text control, distinguishes retained readings and hides unknown usage', async () => {
  const pane = { id: 'context-test', agent: 'omp', status: 'working', ompStatus: { line: 'Test model · project', meters: '◫ 68%/200K · 7d 71%', metersFresh: true } } as Pane
  const wrapper = await mountSuspended(OmpContext, { props: { pane }, attachTo: document.body })
  try {
    expect(wrapper.get('button').text()).toMatch(/68%.*136K/)
    expect(document.querySelector('.omp-context-detail')).toBeNull()
    await wrapper.get('button').trigger('click')
    expect(document.querySelector('.omp-context-detail')?.textContent).toContain('Test model · project')
    expect(document.querySelector('.omp-context-detail')?.textContent).toContain('7d 71%')
    expect(wrapper.get('button').attributes('aria-label')).not.toContain('Last reading')
    await wrapper.setProps({ pane: { ...pane, ompStatus: { ...pane.ompStatus!, metersFresh: false } } })
    expect(wrapper.get('button').attributes('aria-label')).toContain('Last reading; not live')
    await wrapper.setProps({ pane: { ...pane, status: 'idle' } })
    expect(wrapper.get('button').attributes('aria-label')).toContain('Last reading; not live')
    await wrapper.setProps({ pane: { ...pane, ompStatus: { line: 'Test model', meters: '◫ 51.7%/1M', metersFresh: true } } })
    expect(wrapper.get('button').text()).toMatch(/52%.*517K/)
    await wrapper.setProps({ compact: true })
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('51.7')
    expect(wrapper.get('[role="progressbar"]').text()).toBe('')
    await wrapper.setProps({ pane: { ...pane, ompStatus: { line: 'Test model', meters: '▶──200K─120%◀', metersFresh: true } } })
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-label')).toContain('120%')
    await wrapper.setProps({ compact: false })
    expect(wrapper.get('button').text()).toMatch(/120%.*240K/)
    await wrapper.setProps({ pane: { ...pane, ompStatus: undefined } })
    expect(wrapper.find('button').exists()).toBe(false)
    await wrapper.setProps({ compact: true })
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
  } finally { wrapper.unmount() }
})
