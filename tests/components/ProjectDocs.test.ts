import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import { UApp } from '#components'
import ProjectPanel from '~/components/ProjectPanel.vue'
import type { ProjectBoard } from '#shared/projectBoard'

const board: ProjectBoard = { slug: 'acme', version: 'v1', lists: [], open: [], resolved: [] }
registerEndpoint('/api/project/settings', () => ({ settings: {
  name: 'Acme API', goal: 'Ship the public API v2', coordinatorProfile: 'claude', threadProfile: 'codex',
  maxParallelThreads: 3, autoResolveDays: 7, nudge: true, mute: false,
  repos: [{ path: '/srv/code/acme-api', machine: '' }, { path: '/srv/code/acme-web', machine: 'Laptop' }],
  defaults: ['autoResolveDays', 'mute'],
} }))
const asked: string[] = []
registerEndpoint('/api/project/memory', (event) => {
  const name = getQuery(event).name
  if (name === undefined) {
    return { files: [
      { name: 'MEMORY.md', title: 'MEMORY.md', hook: '', index: true },
      { name: 'release.md', title: 'Release checklist', hook: 'what to check before tagging' },
      { name: 'gone.md', title: 'Gone', hook: '', missing: true },
    ] }
  }
  asked.push(String(name))
  return { name, text: '# Release checklist\n\n1. Tests **green**.\n', truncated: false }
})

async function mountTab(key: string) {
  const Host = defineComponent({ render: () => h(UApp, null, () => h(ProjectPanel, { paneId: `w2:${key}`, board, loading: false, error: '' })) })
  const w = await mountSuspended(Host)
  await w.find(`#pp-tab-${key}`).trigger('click')
  return w
}

describe('ProjectPanel › Settings and Memory tabs', () => {
  it('has six tabs', async () => {
    const Host = defineComponent({ render: () => h(UApp, null, () => h(ProjectPanel, { paneId: 'w2:tabs', board, loading: false, error: '' })) })
    const w = await mountSuspended(Host)
    expect(w.findAll('[role="tab"]').map(b => b.text())).toEqual(['Tasks', 'Threads0', 'Inbox', 'Routines', 'Settings', 'Memory'])
  })

  it('shows the settings read-only, marking the plugin’s defaults', async () => {
    const w = await mountTab('settings')
    await vi.waitFor(() => expect(w.findAll('.ps-row')).toHaveLength(8))
    const rows = Object.fromEntries(w.findAll('.ps-row').map(r => [r.find('.ps-key').text(), r.find('dd').text()]))
    expect(rows).toEqual({
      name: 'Acme API', goal: 'Ship the public API v2', coordinator_profile: 'claude', thread_profile: 'codex',
      max_parallel_threads: '3', auto_resolve_days: '7 daysdefault', nudge: 'On', mute: 'Offdefault',
    })
    expect(w.findAll('.ps-repos li').map(x => x.text())).toEqual(['/srv/code/acme-api', '/srv/code/acme-webLaptop'])
    expect(w.findAll('.ps button, .ps input, .ps select, .ps textarea')).toHaveLength(0)
  })

  it('lists memory files and opens one as Markdown', async () => {
    const w = await mountTab('memory')
    await vi.waitFor(() => expect(w.findAll('.pm-card')).toHaveLength(3))
    expect(w.findAll('.pm-card .pp-thread-title').map(x => x.text())).toEqual(['Index', 'Release checklist', 'Gone'])
    expect(w.findAll('.pm-card .pp-meta').map(x => x.text())).toEqual(['MEMORY.md', 'memory/release.md', 'memory/gone.md · missing'])
    // A file the index lists but that does not exist is not asked for.
    await w.findAll('.pm-file')[2]!.trigger('click')
    await new Promise(r => setTimeout(r, 30))
    expect(asked).toEqual([])
    await w.findAll('.pm-file')[1]!.trigger('click')
    await vi.waitFor(() => expect(asked).toEqual(['release.md']))
    await vi.waitFor(() => expect(document.body.querySelector('.pm-doc .pm-path')?.textContent).toBe('memory/release.md'), { timeout: 5000 })
    const doc = document.body.querySelector('.pm-doc')!
    // Rendered as Markdown. (Sanitizing needs a real browser: tests/e2e/project-docs.spec.ts.)
    await vi.waitFor(() => expect(doc.querySelector('.md strong')?.textContent).toBe('green'), { timeout: 5000 })
    expect(w.findAll('.pm input, .pm textarea')).toHaveLength(0)
  })
})
