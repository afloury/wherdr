import { describe, expect, it } from 'vitest'
import { SCRIPT, bbReady, taskGuards, type Receipt } from '../shared/pm/actions'
import { runAction, type ActionJob } from '../server/utils/pmActions'
import type { StepAction, Template } from '../shared/pm/workflow'

const t: Template = { id: 'p', guards: { protected: ['main'], merge: { protected: 'user', others: 'engine' } }, taskTypes: { simple: { steps: [] } } }
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const pr = (over: object = {}) => ({ id: 7, state: 'OPEN', destination: { branch: { name: 'dev' } }, source: { commit: { hash: HEAD.slice(0, 12) } }, links: { html: { href: 'https://bitbucket.example/pr/7' } }, ...over })

// A fake Bitbucket Cloud API behind the action's scripts: each answer is the
// body then the HTTP status, as the bitbucket script prints them.
function fakeBitbucket(o: { prs?: object[], statuses?: object[][], merge?: [number, object] } = {}) {
  const receipts = new Map<string, Receipt>()
  const calls: string[][] = [], sleeps: number[] = []
  const statuses = [...(o.statuses ?? [[]])]
  const reply = (status: number, body: object) => ({ code: 0, out: `${JSON.stringify(body)}\n${status}` })
  const sh = async (script: string, args: string[]) => {
    calls.push(args.slice(1))
    if (script === SCRIPT.head) return { code: 0, out: HEAD }
    if (script === SCRIPT.contains) return { code: 0, out: 'origin/dev' }
    const [, method, path] = args
    if (path?.startsWith('/pullrequests?')) return reply(200, { values: o.prs ?? [pr()] })
    if (path?.endsWith('/statuses')) return reply(200, { values: statuses.length > 1 ? statuses.shift() : statuses[0] })
    if (method === 'POST') return reply(...(o.merge ?? [200, { state: 'MERGED' }]))
    return { code: 1, out: 'unexpected call' }
  }
  const deps = { store: { receipt: async (id: string) => receipts.get(id) ?? null, saveReceipt: async (r: Receipt) => { receipts.set(r.id, r) } }, sh, sleep: async (ms: number) => { sleeps.push(ms) } }
  const go = (action: StepAction = { kind: 'bitbucket.merge' }, over: Partial<ActionJob> = {}) => runAction(deps, {
    task: { id: 'A-1', title: 'T', description: 'D' }, step: 'merge', attempt: 1, action, by: 'engine',
    guards: taskGuards(t, 'simple'), worktree: '/w', branch: 'task/A-1', ...over,
  })
  return { go, calls, sleeps }
}

describe('bitbucket.merge', () => {
  it('waits for the builds, then merges with a merge commit', async () => {
    const f = fakeBitbucket({ statuses: [[{ key: 'ci', state: 'INPROGRESS' }], [{ key: 'ci', state: 'SUCCESSFUL' }]] })
    expect(await f.go()).toEqual({ ok: true, link: 'https://bitbucket.example/pr/7', commit: HEAD })
    expect(f.sleeps).toEqual([60_000])
    expect(f.calls).toContainEqual(['GET', '/pullrequests?state=OPEN&state=MERGED&sort=-updated_on&pagelen=50', 'q=source.branch.name="task/A-1"'])
    const merge = f.calls.find(c => c[0] === 'POST')!
    expect(merge[1]).toBe('/pullrequests/7/merge')
    expect(JSON.parse(merge[2]!)).toEqual({ type: 'pullrequest', merge_strategy: 'merge_commit', close_source_branch: false })
  })

  it('says why Bitbucket refused the merge, and never merges on a failed or missing check', async () => {
    expect(await fakeBitbucket({ merge: [400, { type: 'error', error: { message: 'Requires 2 approvals' } }] }).go())
      .toEqual({ ok: false, error: 'merge: Requires 2 approvals' })
    const red = fakeBitbucket({ statuses: [[{ key: 'ci', state: 'FAILED' }]] })
    expect(await red.go()).toEqual({ ok: false, error: 'merge: 1 check(s) failed' })
    expect(red.calls.some(c => c[0] === 'POST')).toBe(false)
    expect(bbReady([{ key: 'ci', state: 'SUCCESSFUL' }], ['smoke'])).toEqual({ ok: false, later: true, why: 'waiting for check smoke' })
    expect(bbReady([{ name: 'smoke', state: 'SUCCESSFUL' }], ['smoke'])).toEqual({ ok: true })
  })

  it('leaves a protected base to the user, merges on their gesture, and records a merge done by hand', async () => {
    const main = fakeBitbucket({ prs: [pr({ destination: { branch: { name: 'main' } } })] })
    expect(await main.go()).toEqual({ ok: false, error: 'main is protected: only you may merge into it' })
    expect(main.calls.some(c => c[0] === 'POST')).toBe(false)
    expect(await main.go({ kind: 'bitbucket.merge', method: 'squash' }, { by: 'user', attempt: 2 })).toMatchObject({ ok: true })
    expect(JSON.parse(main.calls.find(c => c[0] === 'POST')![2]!)).toMatchObject({ merge_strategy: 'squash' })
    expect(await fakeBitbucket({ prs: [pr({ state: 'MERGED' })] }).go()).toMatchObject({ ok: true, note: 'already merged on Bitbucket' })
  })
})
