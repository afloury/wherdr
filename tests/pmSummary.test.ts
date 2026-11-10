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
// the reviewer's verdict with one finding, the fix. File contents, proofs and
// private paths live elsewhere in the task: none of it may reach the model.
function task(id: string, at = 1000): Task {
  return {
    id, project: 'CO', title: 'Export to CSV', type: 'feature', state: 'working',
    description: 'Secret plan in ~/project, read /Users/someone/notes.txt',
    log: [
      { at, by: 'worker claude opus', text: 'work: done' },
      { at: at + 1, by: 'reviewer codex gpt', text: 'review: verdict, 1 finding(s)' },
      { at: at + 2, by: 'engine', text: 'review: sent to the worker' },
    ],
    step: {
      ...initialState(), started: true, at: 0,
      proofs: { work: { report: `Built the CSV export. Logs in ${HOME}/app.log, token ${TOKEN}` } },
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

describe('summaryTick', () => {
  it('sends only the reports and verdicts, masked, and keeps the answer for the round', async () => {
    const store = fakeStore([task('CO-1')])
    const prompts: string[] = []
    const summarize = async (p: string) => { prompts.push(p); return '\n- Built the CSV export.\n- Review: a missing test, added.\n\n' }
    await summaryTick({ store, summarize, pace: go }, 5000)
    expect(prompts).toHaveLength(1)
    const p = prompts[0]!
    expect(p).toContain('Export to CSV')
    expect(p).toContain('Built the CSV export.')
    expect(p).toContain('No test for empty rows')
    // No description, no proof, no private path or token.
    expect(p).not.toMatch(/Secret plan|SECRET FILE/)
    expect(p).not.toContain(HOME)
    expect(p).not.toContain(TOKEN)
    expect(p).toContain('[home path]')
    expect((await store.task('CO-1'))!.summary).toEqual({ round: 2, text: '- Built the CSV export.\n- Review: a missing test, added.', at: 5000 })
    // Same round: not asked again.
    await summaryTick({ store, summarize, pace: go }, 6000)
    expect(prompts).toHaveLength(1)
  })

  it('makes it again when a new report arrives', async () => {
    const t = task('CO-2')
    const store = fakeStore([{ ...t, summary: { round: 2, text: 'old', at: 1 } }])
    let n = 0
    const summarize = async () => `summary ${++n}`
    await summaryTick({ store, summarize, pace: go }, 5000)
    expect(n).toBe(0)
    await store.saveTask({ ...(await store.task('CO-2'))!, log: [...t.log!, { at: 2000, by: 'worker claude opus', text: 'work: done' }] })
    await summaryTick({ store, summarize, pace: go }, 5000)
    expect((await store.task('CO-2'))!.summary).toMatchObject({ round: 3, text: 'summary 1' })
  })

  it('is skipped while the pace holds automatic work, and for a task with nothing reported', async () => {
    const store = fakeStore([task('CO-3'), { ...task('CO-4'), log: [] }])
    let n = 0
    const summarize = async () => `s${++n}`
    await summaryTick({ store, summarize, pace: held }, 5000)
    expect(n).toBe(0)
    await summaryTick({ store, summarize, pace: go }, 5000)
    await summaryTick({ store, summarize, pace: go }, 5000)
    expect(n).toBe(1) // CO-4 has no report: nothing to summarize
    expect((await store.task('CO-4'))!.summary).toBeUndefined()
  })
})
