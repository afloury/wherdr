import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import OmpTool from '~/components/OmpTool.vue'
import type { ChatItem, OmpToolView } from '#shared/types'

function tool(omp: OmpToolView, error = false): ChatItem & { omp: OmpToolView } {
  return { role: 'tool', text: '', ts: '2026-01-01T00:00:00.000Z', omp, ...(error ? { error: true } : {}) } as ChatItem & { omp: OmpToolView }
}

describe('OmpTool console line', () => {
  it('shows the command, its intent and wall time, and unfolds the output on a tap', async () => {
    const w = await mountSuspended(OmpTool, { props: { tool: tool({ title: 'Bash', target: 'npm test', intent: 'Run the tests', ms: 1200, out: 'ok 1\nok 2' }) } })
    expect(w.find('.omp-tool-cmd').text()).toBe('npm test')
    expect(w.text()).toContain('# Run the tests')
    expect(w.find('.omp-tool-glyph').text()).toBe('❯')
    expect(w.find('.omp-tool-out').exists()).toBe(false)
    const head = w.find('button.omp-tool-head')
    expect(head.attributes('aria-expanded')).toBe('false')
    await head.trigger('click')
    expect(head.attributes('aria-expanded')).toBe('true')
    expect(w.find('.omp-tool-out pre').text()).toContain('ok 2')
    await head.trigger('click')
    expect(w.find('.omp-tool-out').exists()).toBe(false)
  })

  it('marks a failed call with ✗ and its exit code', async () => {
    const w = await mountSuspended(OmpTool, { props: { tool: tool({ title: 'Bash', target: 'npm test', exit: 2, ms: 300, out: 'fail 1' }, true) } })
    expect(w.classes()).toContain('err')
    expect(w.find('.omp-tool-glyph').text()).toBe('✗')
    expect(w.find('.omp-tool-exit').text()).toBe('exit 2')
  })

  it('a call without output does not unfold', async () => {
    const w = await mountSuspended(OmpTool, { props: { tool: tool({ title: 'Read', target: 'TASKS.md:5-20', ms: 20 }) } })
    expect(w.find('button').exists()).toBe(false)
    expect(w.find('.omp-tool-cmd').text()).toBe('read TASKS.md:5-20')
  })

  it('a running call shows the spinner instead of a wall time', async () => {
    const w = await mountSuspended(OmpTool, { props: { tool: tool({ title: 'Bash', target: 'sleep 5', intent: 'Wait', ms: 5000 }), live: true } })
    expect(w.find('.omp-tool-glyph').text()).not.toBe('❯')
    expect(w.text()).not.toContain('5.0s')
  })
})
