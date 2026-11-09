// Runs one engine action in a task's worktree, on its project's machine:
// guard first, receipt before, transient errors tried again (1, 2, 4, 8 min),
// then the alert when the task's commit sits on a protected branch that no
// step of the user and no guarded action put it on.
import { PATH_SETUP, type CoreAdminDeps } from './coreCreate'
import { exec } from './pmLaunch'
import type { PmStore } from './pmStore'
import { mayMerge } from '../../shared/pm/guards'
import { BB_STRATEGY, CODE, RETRY_MS, SCRIPT, bbReady, guardAction, isTransient, leaks, prReady, receiptId, type ActionResult, type PrInfo } from '../../shared/pm/actions'
import type { ResolvedGuards } from '../../shared/pm/guards'
import type { BbStatus } from '../../shared/pm/actions'
import type { MergeBy, StepAction } from '../../shared/pm/workflow'

type Shell = (script: string, args: string[], input?: string) => Promise<{ code: number | null, out: string }>
export interface ActionDeps {
  store: Pick<PmStore, 'receipt' | 'saveReceipt'>
  sh: Shell
  sleep?: (ms: number) => Promise<void>
}
export interface ActionJob {
  task: { id: string, title: string, description: string, project?: string }
  step: string
  attempt: number // from the step engine's action effect
  action: StepAction
  by: MergeBy // 'user' when the user's gesture started it
  guards: ResolvedGuards
  worktree: string
  branch: string
  allowed?: string[] // protected branches the task already reached through you
  reviewed?: string // a PR merge: the commit the last review passed
  halted?: () => Promise<boolean> // the task was stopped meanwhile: no merge
}

// The shell of a project's machine, through herdr-core. stderr is kept: a
// transient error is often only there.
export const actionShell = (deps: Pick<CoreAdminDeps, 'call'>, on: string | undefined): Shell =>
  async (script, args, input) => {
    const r = await exec(deps, on, `${PATH_SETUP}\n${script}`, args, input)
    return { code: r.code, out: [r.out, r.err].filter(Boolean).join('\n') }
  }

const lastLine = (out: string) => out.trim().split('\n').pop()?.trim().slice(0, 300) || ''
const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function runAction(deps: ActionDeps, job: ActionJob): Promise<ActionResult> {
  const { store } = deps
  const id = receiptId(job.task.id, job.step, job.attempt)
  const base = { id, task: job.task.id, step: job.step, action: job.action }
  const prev = await store.receipt(id)
  if (prev?.state === 'done') return prev.result!
  if (prev) {
    await store.saveReceipt({ ...prev, state: 'uncertain' })
    return { ok: false, error: `${job.action.kind} was interrupted before its result was known: check by hand, then try again` }
  }
  const refused = guardAction(job.guards, job.action, { branch: job.branch, by: job.by, project: job.task.project })
  if (refused) return finish({ ok: false, error: refused })
  await store.saveReceipt({ ...base, state: 'pending', at: Date.now() })
  return finish(await perform(deps, job))

  async function finish({ reached, ...result }: Done) {
    if (result.ok) {
      const alert = await leakAlert(deps, job, result, reached ?? []).catch(() => undefined)
      if (alert) result = { ...result, alert: [result.alert, alert].filter(Boolean).join('. ') }
    }
    await store.saveReceipt({ ...base, state: 'done', result, at: Date.now() })
    return result
  }
}

// Runs a script in the worktree; a transient error is tried again.
async function run(deps: ActionDeps, script: string, args: string[], input?: string) {
  for (let i = 0; ; i++) {
    const r = await deps.sh(script, args, input)
    if (r.code === 0 || !isTransient(r.code, r.out) || i >= RETRY_MS.length) return r
    await (deps.sleep ?? pause)(RETRY_MS[i]!)
  }
}

// reached: the protected branch a guarded merge put the commit on.
type Done = ActionResult & { reached?: string[] }

async function perform(deps: ActionDeps, job: ActionJob): Promise<Done> {
  const { action: a, worktree: wt, branch } = job
  const name = a.kind.split('.')[1]
  const fail = (r: { code: number | null, out: string }): ActionResult =>
    ({ ok: false, error: `${name}: ${r.code === null ? 'timed out' : lastLine(r.out) || `exit code ${r.code}`}`, ...(r.code === CODE.SEND_BACK ? { toAgent: true } : {}) })
  const commit = async (script: string, args: string[]) => {
    const r = await run(deps, script, [wt, ...args])
    return r.code === 0 ? { ok: true, commit: lastLine(r.out) } : fail(r)
  }
  switch (a.kind) {
    case 'git.land': return commit(SCRIPT.land, [a.target!])
    case 'git.push': return commit(SCRIPT.push, [branch])
    case 'git.verify-merged': return commit(SCRIPT.verify, [a.target!, branch])
    case 'github.pr': {
      const r = await run(deps, SCRIPT.pr, [wt, branch, a.base!, `${job.task.id}: ${job.task.title}`], job.task.description || job.task.title)
      return r.code === 0 ? { ok: true, link: lastLine(r.out) } : fail(r)
    }
    case 'github.merge': {
      let pushed = false
      for (let i = 0; ; i++) {
        const r = await run(deps, SCRIPT.prInfo, [wt, branch])
        if (r.code !== 0) return fail(r)
        const lines = r.out.split('\n'), head = lines[0] ?? ''
        let pr: PrInfo | undefined
        try { pr = (JSON.parse(lines.at(-1) || '[]') as PrInfo[])[0] }
        catch { return { ok: false, error: 'merge: unreadable PR details' } }
        // Merged on GitHub already (by hand, or a merge answered with an error): done.
        // Its base counts as reached only where this step could have merged:
        // a protected branch merged outside your gesture still raises the alert.
        if (pr?.merged) {
          const reached = mayMerge(job.guards, pr.baseRefName, job.by) ? [pr.baseRefName] : []
          if (!pr.stray) return { ok: true, link: pr.url, commit: head.trim(), reached, note: 'already merged on GitHub' }
          // Merged at a head without the task's commit: what GitHub merged is recorded, and what it left out is said.
          const h = head.trim().slice(0, 7), m = pr.headRefOid.slice(0, 7)
          return { ok: true, link: pr.url, commit: pr.headRefOid, reached, note: `already merged on GitHub at ${m}, without the task's commit ${h}`,
            alert: `${job.task.id}'s commit ${h} was not merged: its PR was merged on GitHub at ${m} without it. Its later commits need a new branch` }
        }
        const refused = pr && guardAction(job.guards, a, { branch, by: job.by, base: pr.baseRefName })
        if (refused) return { ok: false, error: refused }
        if (pr) {
          const h = head.trim(), at = await run(deps, SCRIPT.headOf, [wt, pr.headRefOid])
          if (at.code !== 0) return fail(at)
          const where = lastLine(at.out)
          if (where === 'foreign') return { ok: false, error: `merge: the PR head ${pr.headRefOid.slice(0, 7)} has commits the task's worktree never had (pushed from elsewhere): bring them into the worktree, or merge by hand` }
          // The head moved after the review (catch-up, conflict, CI fix): reviewed again first.
          if (job.reviewed && job.reviewed !== h) return { ok: false, error: `merge: new commits since the review (${job.reviewed.slice(0, 7)}..${h.slice(0, 7)})`, review: { since: job.reviewed, head: h }, commit: h }
          if (where === 'behind') {
            if (pushed) return { ok: false, error: 'merge: the push did not move the PR head' }
            const no = guardAction(job.guards, { kind: 'git.push' }, { branch, by: job.by })
            if (no) return { ok: false, error: no }
            const up = await run(deps, SCRIPT.push, [wt, branch])
            if (up.code !== 0) return fail(up)
            pushed = true
            continue
          }
        }
        const ready = prReady(pr, head.trim(), a.checks)
        if (!ready.ok && ready.later && i < RETRY_MS.length) { await (deps.sleep ?? pause)(RETRY_MS[i]!); continue }
        if (!ready.ok) return { ok: false, error: `merge: ${ready.why}` }
        if (await job.halted?.()) return { ok: false, error: 'merge: the task was stopped' }
        const m = await run(deps, SCRIPT.merge, [wt, pr!.url, head.trim(), a.method ?? ''])
        return m.code === 0 ? { ok: true, link: pr!.url, commit: head.trim(), reached: [pr!.baseRefName] } : fail(m)
      }
    }
    case 'bitbucket.merge': return bitbucketMerge(deps, job, fail)
  }
}

interface BbPr { id: number, state: string, destination: { branch: { name: string } }, source: { commit: { hash: string } }, links: { html: { href: string } } }

// As github.merge, through the Bitbucket Cloud API: the task's open PR, its
// guard on the PR's destination, its head pushed when behind, its build
// statuses waited for, then a merge commit unless the step names a method.
// Bitbucket gives a commit's first 12 characters.
async function bitbucketMerge(deps: ActionDeps, job: ActionJob, fail: (r: { code: number | null, out: string }) => ActionResult): Promise<Done> {
  const { action: a, worktree: wt, branch } = job
  const api = async <T>(method: string, path: string, arg: string) => {
    const r = await run(deps, SCRIPT.bitbucket, [wt, method, path, arg])
    if (r.code !== 0) return { error: fail(r) }
    const lines = r.out.trim().split('\n'), status = Number(lines.pop())
    try { return { status, body: JSON.parse(lines.pop() || '{}') as T & { error?: { message?: string } } } }
    catch { return { error: { ok: false, error: 'merge: unreadable Bitbucket answer' } } }
  }
  const refusal = (r: { status: number, body: { error?: { message?: string } } }) => ({ ok: false, error: `merge: ${r.body.error?.message || `Bitbucket answered ${r.status}`}` })
  let pushed = false
  for (let i = 0; ; i++) {
    const h = await run(deps, SCRIPT.head, [wt])
    if (h.code !== 0) return fail(h)
    const head = lastLine(h.out)
    const list = await api<{ values?: BbPr[] }>('GET', '/pullrequests?state=OPEN&state=MERGED&sort=-updated_on&pagelen=50', `q=source.branch.name="${branch}"`)
    if ('error' in list) return list.error!
    if (list.status !== 200) return refusal(list)
    const prs = list.body.values ?? [], pr = prs.find(p => p.state === 'OPEN')
    if (!pr) {
      const done = prs.find(p => p.state === 'MERGED' && head.startsWith(p.source.commit.hash))
      if (!done) return { ok: false, error: 'merge: no open PR for this task' }
      const base = done.destination.branch.name
      return { ok: true, link: done.links.html.href, commit: head, reached: mayMerge(job.guards, base, job.by) ? [base] : [], note: 'already merged on Bitbucket' }
    }
    const base = pr.destination.branch.name, link = pr.links.html.href
    const refused = guardAction(job.guards, a, { branch, by: job.by, base })
    if (refused) return { ok: false, error: refused }
    if (job.reviewed && job.reviewed !== head) return { ok: false, error: `merge: new commits since the review (${job.reviewed.slice(0, 7)}..${head.slice(0, 7)})`, review: { since: job.reviewed, head }, commit: head }
    if (!head.startsWith(pr.source.commit.hash)) {
      if (pushed) return { ok: false, error: `merge: the PR head ${pr.source.commit.hash.slice(0, 7)} is not the task's commit` }
      const no = guardAction(job.guards, { kind: 'git.push' }, { branch, by: job.by })
      if (no) return { ok: false, error: no }
      const up = await run(deps, SCRIPT.push, [wt, branch])
      if (up.code !== 0) return fail(up)
      pushed = true
      continue
    }
    const st = await api<{ values?: BbStatus[] }>('GET', `/commit/${head}/statuses`, 'pagelen=100')
    if ('error' in st) return st.error!
    if (st.status !== 200) return refusal(st)
    const ready = bbReady(st.body.values ?? [], a.checks)
    if (!ready.ok && ready.later && i < RETRY_MS.length) { await (deps.sleep ?? pause)(RETRY_MS[i]!); continue }
    if (!ready.ok) return { ok: false, error: `merge: ${ready.why}` }
    if (await job.halted?.()) return { ok: false, error: 'merge: the task was stopped' }
    const body = JSON.stringify({ type: 'pullrequest', merge_strategy: BB_STRATEGY[a.method ?? 'merge'], close_source_branch: false })
    const m = await api<object>('POST', `/pullrequests/${pr.id}/merge`, body)
    if ('error' in m) return m.error!
    return m.status === 200 ? { ok: true, link, commit: head, reached: [base] } : refusal(m)
  }
}

// Only after a success: a failed action reached nothing new.
async function leakAlert(deps: ActionDeps, job: ActionJob, result: ActionResult, merged: string[]) {
  const r = await deps.sh(SCRIPT.contains, [job.worktree])
  if (r.code !== 0) return
  const a = job.action
  // What this action itself reached went through its guard; verify-merged only
  // confirms a merge when you said it was done.
  const reached = a.kind === 'git.land' || (a.kind === 'git.verify-merged' && job.by === 'user') ? [a.target!] : []
  const found = leaks(job.guards, r.out.split('\n').map(s => s.trim()).filter(Boolean), [...(job.allowed ?? []), ...reached, ...merged])
  if (found.length) return `${job.task.id}'s commit ${result.commit?.slice(0, 7) || '?'} is on ${found.join(', ')} without a step of yours`
}
