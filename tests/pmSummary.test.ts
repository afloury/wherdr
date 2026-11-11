import { describe, expect, it } from 'vitest'
import { summaryTick } from '../server/utils/pmSummary'
import { company } from '../shared/pm/examples'
import { initialState } from '../shared/pm/steps'
import type { Task } from '../shared/pm/run'
import type { PmStore } from '../server/utils/pmStore'

// A token shape, built here so the repository's leak check passes.
const TOKEN = ['gh', 'p_', 'a'.repeat(36)].join('')
const HOME = ['', 'Users', 'jdoe'].join('/')
const go = async () => ({ go: true as const })
const held = async () => ({ go: false as const, reason: 'reserveWeek' as const, until: null })

// A task through one send-back: the worker's report (kept on its last done),
// the reviewer's verdict with one finding, the fix. File contents and proofs
// live elsewhere in the task: none of it may reach the model; the description
// and the reports go, their private paths and tokens masked.
const work = (commits: string) => ({ commits, files: [{ path: 'src/csv.ts', add: 40, del: 2 }] })
function task(id: string, at = 1000): Task {
  return {
    id, project: 'CO', title: 'Export to CSV', type: 'feature', state: 'working',
    description: `Add an export, notes in ${HOME}/notes.txt`, work: work('111 2'),
    log: [
      { at, by: 'worker claude opus', text: 'work: done' },
      { at: at + 1, by: 'reviewer codex gpt', text: 'review: verdict, 1 finding(s)' },
      { at: at + 2, by: 'engine', text: 'review: sent to the worker' },
    ],
    step: {
      ...initialState(), started: true, at: 0,
      proofs: { work: { report: `Built the CSV export. Logs in ${HOME}/app.log, token ${TOKEN}`, commit: 'SECRET FILE CONTENTS' } },
      reviews: { review: [{ findings: [{ id: 'no-test', severity: 'major', title: 'No test for empty rows', where: 'src/csv.ts:12', proof: 'SECRET FILE CONTENTS' }] }] },
    },
  } as Task
}

function fakeStore(tasks: Task[]) {
  const byId = new Map(tasks.map(t => [t.id, t]))
  return {
    enabled: async () => true,
    projects: async () => [{ key: 'CO', name: 'CO', machine: '', path: '/src', addedAt: 1 }],
    workflow: async () => company,
    tasks: async () => [...byId.values()],
    task: async (id: string) => byId.get(id) ?? null,
    saveTask: async (t: Task) => { byId.set(t.id, t); return t },
  } as unknown as PmStore
}

describe('summaryTick (the TL;DR)', () => {
  it('sends the title, description, reports, files and Merge, masked, no file contents', async () => {
    const store = fakeStore([task('CO-1')])
    const prompts: string[] = []
    const summarize = async (p: string) => { prompts.push(p); return '\n- Adds a CSV export.\n- Review: a missing test, added.\n\n' }
    await summaryTick({ store, summarize, pace: go }, 5000)
    expect(prompts).toHaveLength(1)
    const p = prompts[0]!
    for (const s of ['Export to CSV', 'Add an export', 'Built the CSV export.', 'No test for empty rows', '- src/csv.ts +40 -2', 'merges the PR into develop', '[home path]']) expect(p).toContain(s)
    expect(p).not.toContain('SECRET FILE')
    expect(p).not.toContain(HOME)
    expect(p).not.toContain(TOKEN)
    expect((await store.task('CO-1'))!.tldr).toMatchObject({ text: '- Adds a CSV export.\n- Review: a missing test, added.', at: 5000 })
    // Nothing new: not asked again.
    await summaryTick({ store, summarize, pace: go }, 6000)
    expect(prompts).toHaveLength(1)
  })

  it('is written again on a report with new commits, not on a base merge or a CI re-run', async () => {
    const store = fakeStore([task('CO-2')])
    let n = 0
    const summarize = async () => `tldr ${++n}`
    const tick = () => summaryTick({ store, summarize, pace: go }, 5000)
    const add = async (more: Partial<Task>, line: { by: string, text: string }) => {
      const t = (await store.task('CO-2'))!
      await store.saveTask({ ...t, ...more, log: [...t.log!, { at: 2000 + t.log!.length, ...line }] })
    }
    await tick()
    expect(n).toBe(1)
    // The engine merges the base in and re-runs CI: the task's own commits are the same.
    await add({}, { by: 'engine', text: 'merge: updated with v3' })
    await add({}, { by: 'engine', text: 'rerun-ci: 1 check failed, ran again' })
    await tick()
    expect(n).toBe(1)
    // The worker reports the fix with a new commit.
    await add({ work: work('222 3') }, { by: 'worker claude opus', text: 'work: done' })
    await tick()
    expect((await store.task('CO-2'))!.tldr?.text).toBe('tldr 2')
  })

  it('waits while the pace holds automatic work, the task marked; and skips a task with nothing reported', async () => {
    const store = fakeStore([task('CO-3'), { ...task('CO-4'), log: [] }])
    let n = 0
    const summarize = async () => `s${++n}`
    await summaryTick({ store, summarize, pace: held }, 5000)
    expect(n).toBe(0)
    expect((await store.task('CO-3'))!.tldrHeld).toBe(true)
    await summaryTick({ store, summarize, pace: go }, 5000)
    await summaryTick({ store, summarize, pace: go }, 5000)
    expect(n).toBe(1) // CO-4 has no report: nothing to write
    expect((await store.task('CO-3'))!.tldrHeld).toBeUndefined()
    expect((await store.task('CO-4'))!.tldr).toBeUndefined()
  })
})
