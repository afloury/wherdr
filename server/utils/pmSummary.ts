// Each task's summary (shared/pm/summary.ts), made again when a new report or
// verdict starts a round: one task at a time, by Claude Haiku through the
// claude CLI on this machine, skipped while the pace of its Claude account
// holds automatic work. Every minute (plugins/pm.ts), one task per pass.
import { spawn } from 'node:child_process'
import { accountFor } from '../../shared/quotaAccount'
import { DEFAULT_PACE, paceVerdict, type PaceVerdict } from '../../shared/pm/pacing'
import { accountQuota } from '../../shared/pm/pace'
import { taskPlan } from '../../shared/pm/run'
import { cleanSummary, summaryPrompt, summarySource } from '../../shared/pm/summary'
import { PATH_SETUP } from './coreCreate'
import type { PmStore } from './pmStore'
import { readQuotas } from './quotas'
import { policyIn, readPolicies } from './pacingPolicies'

export type Summarize = (prompt: string) => Promise<string>
export interface SummaryDeps { store: PmStore, summarize?: Summarize, pace?: (now: number) => Promise<PaceVerdict> }

const STALE = 86_400_000 // a task whose last report or verdict is older keeps its summary as it is
const failed = new Map<string, number>() // task → the round that failed: not tried again until the next one

export async function summaryTick(deps: SummaryDeps, now = Date.now()) {
  if (!(await deps.store.enabled())) return
  const projects = await deps.store.projects()
  for (const task of await deps.store.tasks()) {
    const p = projects.find(x => x.key === task.project)
    const t = p ? await deps.store.workflow(p.key) : null
    if (!t) continue
    const src = summarySource(task, taskPlan(t, task, p))
    if (!src || task.summary?.round === src.round || failed.get(task.id) === src.round || now - src.last > STALE) continue
    if (!(await (deps.pace ?? claudePace)(now)).go) return
    const text = await (deps.summarize ?? haiku)(summaryPrompt(src.input)).then(cleanSummary, () => '')
    if (!text) { failed.set(task.id, src.round); continue }
    const fresh = await deps.store.task(task.id)
    if (fresh) await deps.store.saveTask({ ...fresh, summary: { round: src.round, text, at: now } })
    return // one per pass: the next waits for the next minute
  }
}

// The pace of this machine's Claude account, the one Haiku runs on.
async function claudePace(now: number): Promise<PaceVerdict> {
  const q = await readQuotas().catch(() => null)
  const account = accountFor(q?.accounts, '', 'claude')
  const policy = account ? policyIn(await readPolicies(), account.key) : DEFAULT_PACE
  return paceVerdict(policy, q && account ? accountQuota(q, account) : null, now)
}

// `claude -p` with Haiku, the prompt on its standard input, no tools, no
// session kept; safe mode: the user's CLAUDE.md, hooks and plugins stay out.
const haiku: Summarize = prompt => new Promise((resolve, reject) => {
  const child = spawn('sh', ['-c', `${PATH_SETUP}; exec claude -p --safe-mode --model haiku --tools "" --no-session-persistence`], {
    env: { ...process.env, DISABLE_AUTOUPDATER: '1' }, stdio: ['pipe', 'pipe', 'ignore'],
  })
  let out = ''
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
  child.stdout.on('data', (b: Buffer) => { if (out.length < 20_000) out += b.toString('utf8') })
  child.on('error', reject)
  child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new Error(`claude exited with ${code}`)) })
  child.stdin.on('error', () => {})
  child.stdin.end(prompt)
})
