// Threads tab of the Project panel: one thread's record and the actions on it,
// all through herdr-projects commands on the coordinator's machine (`thread
// show --json`, `thread stop|restart|ack|resolve`). wherdr reads or writes no
// thread file itself. argv only, identifiers checked (shared/projectThreads.ts).
import type { Pane } from '../../shared/types'
import { type ThreadAction, type ThreadDetail, THREAD_ID_RE, THREAD_TIMEOUT_MS, isThreadAction, lastLine, normalizeThreadDetail, threadCommandArgs } from '../../shared/projectThreads'
import { HerdrError } from './herdr'
import { stripAnsi } from './pluginPolicy'
import { type Target, projectsRoot, runProjectCommand, target } from './projectBoard'

type Where = Pick<Target, 'm' | 'bin' | 'dir' | 'slug'>

function argsFor(command: ThreadAction | 'show', t: Where, id: string): string[] {
  try { return threadCommandArgs(command, projectsRoot(t), t.slug, id) }
  catch (e) { throw new HerdrError('bad_thread', (e as Error).message) }
}

// `thread show <slug> <id> --json`.
export async function threadDetailOn(t: Where, id: string): Promise<ThreadDetail> {
  const r = await runProjectCommand(t, argsFor('show', t, id), THREAD_TIMEOUT_MS.show)
  if (r.code !== 0) throw new HerdrError('thread_failed', lastLine(stripAnsi(r.stderr || r.stdout)) || `code ${r.code}`)
  let raw: unknown
  try { raw = JSON.parse(r.stdout) }
  catch { throw new HerdrError('thread_failed', 'unreadable thread record') }
  const detail = normalizeThreadDetail(raw)
  if (!detail || detail.id !== id) throw new HerdrError('thread_failed', 'unreadable thread record')
  return detail
}

// Threads with an action in progress (`<machine>|<project folder>|<id>`). One
// action at a time per thread: herdr-projects only locks the write of the
// record, so two `resolve` would both make the final copy and clean up.
const busy = new Set<string>()

// `thread <action> <slug> <id>`: what herdr-projects printed (its last lines
// say what was done, or kept), or its error. Refused while another action
// runs on the same thread, whoever asked for it.
export async function threadActionOn(t: Where, id: string, action: ThreadAction): Promise<{ output: string }> {
  const args = argsFor(action, t, id)
  const key = `${t.m.key ?? ''}|${t.dir}|${id}`
  if (busy.has(key)) throw new HerdrError('thread_busy', 'an action is already running on this thread')
  busy.add(key)
  try {
    const r = await runProjectCommand(t, args, THREAD_TIMEOUT_MS[action])
    const out = stripAnsi(r.stdout).trim()
    if (r.code !== 0) {
      throw new HerdrError('thread_failed', lastLine(stripAnsi(r.stderr || r.stdout)) || `code ${r.code}`)
    }
    return { output: out.slice(-2000) }
  } finally { busy.delete(key) }
}

async function where(pane: Pane, id: unknown): Promise<{ t: Target, id: string }> {
  if (typeof id !== 'string' || !THREAD_ID_RE.test(id)) throw new HerdrError('bad_thread', 'invalid thread')
  const t = await target(pane)
  if (!t) throw new HerdrError('no_project', 'project not found')
  return { t, id }
}

export async function readThreadDetail(pane: Pane, rawId: unknown): Promise<{ thread: ThreadDetail }> {
  const { t, id } = await where(pane, rawId)
  return { thread: await threadDetailOn(t, id) }
}

export async function runThreadAction(pane: Pane, rawId: unknown, action: unknown, guard: <T>(t: Target, run: () => Promise<T>) => Promise<T> = (_t, run) => run()): Promise<{ output: string }> {
  if (!isThreadAction(action)) throw new HerdrError('bad_action', 'Invalid action')
  const { t, id } = await where(pane, rawId)
  return guard(t, () => threadActionOn(t, id, action))
}
