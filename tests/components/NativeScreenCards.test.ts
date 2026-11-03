import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import ChoicesPanel from '~/components/ChoicesPanel.vue'
import { eventsOpen } from '~/composables/useHerdr'
import { screenChoices, ompActiveTab } from '../../server/utils/choices'

const { nav } = vi.hoisted(() => ({ nav: vi.fn(async () => false) }))
mockNuxtImport('navKey', () => nav)
const cases = [
  ['claude-ask-long.txt', 'claude', '.choices-list'],
  ['claude-ask-multi.txt', 'claude', '.choices-list.multi'],
  ['claude-ask-tabs-1.txt', 'claude', '.choices-list'],
  ['omp-ask-single.txt', 'omp', '.choices-list'],
  ['omp-ask-multi.txt', 'omp', '.choices-list.multi'],
  ['omp-ask-tabs.ansi', 'omp', '.choices-tabs'],
  ['claude-security-guide.txt', 'claude', '.choices'],
  ['codex-approve-edits.txt', 'codex', '.choices-list'],
] as const

afterEach(() => { eventsOpen.value = false })
it.each(cases)('renders the native card for %s', async (file, agent, selector) => {
  eventsOpen.value = true
  const raw = readFileSync(`tests/fixtures/${file}`, 'utf8')
  const text = raw.replace(/\x1b\[[0-9;]*m|\r/g, '')
  const prompt = screenChoices(text, agent)
  if (prompt?.tabs) prompt.tab = ompActiveTab(raw, prompt.tabs) ?? undefined
  expect(prompt).toBeTruthy()
  const w = await mountSuspended(ChoicesPanel, { props: { paneId: 'w1:p1', prompt } })
  expect(w.find(selector).exists() || w.element.matches(selector)).toBe(true)
  expect(w.text()).toContain(prompt?.question ?? '')
  if (file === 'omp-ask-multi.txt') {
    expect(prompt!.identity).toEqual(expect.any(String))
    await w.find('.choices-next').trigger('click')
    expect(nav).toHaveBeenCalledExactlyOnceWith('w1:p1', 'enter', prompt!.identity)
  }
  w.unmount()
})
