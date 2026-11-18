// A feature's plan file (shared/pm/planRefs.ts), on the workspace's machine,
// under its root: read for `feature split --from`, `feature close` and the
// write-back, and written back by the engine (never the coordinator: its edits
// in the root are denied) once a sub-task with refs is done. Each script
// resolves symlinks first and refuses a file outside the real root, as repo
// adopt does; the write-back touches the plan file only.
import { endsMerged } from '../../shared/pm/actions'
import { planCommitMessage, skippedText, tickPlan } from '../../shared/pm/planRefs'
import { shownTaskId } from '../../shared/pm/projectKey'
import { effectiveProject, isRootMember, membersOf, workspaceOf } from '../../shared/pm/workspace'
import { taskPlan, type Task } from '../../shared/pm/run'
import type { Project } from '../../shared/pm/project'
import { machineOn } from './coreCreate'
import { HerdrError } from './herdr'
import { exec, type PmLaunchDeps } from './pmLaunch'
import { wakeCoordinators } from './pmWakes'

// $1: the root, $2: the file (relative to it; an absolute path inside it works too).
// The real root and file (every symlink followed, the file's own too) or an exit:
// 3 the file leads outside the root, 4 it is not a file.
const RESOLVE = `root=$1
case $root in "~"|"~/"*) root="$HOME\${root#"~"}";; esac
r=$(cd -P "$root" 2>/dev/null && pwd) || exit 1
case $2 in "~"|"~/"*) full="$HOME\${2#"~"}";; /*) full=$2;; *) full="$r/$2";; esac
real() {
  p=$1 n=0
  while :; do
    d=$(cd -P "$(dirname "$p")" 2>/dev/null && pwd) || return 1
    p=$d/$(basename "$p")
    [ -L "$p" ] && [ "$n" -lt 20 ] || break
    l=$(readlink "$p") || return 1
    case $l in /*) p=$l;; *) p=$d/$l;; esac
    n=$((n + 1))
  done
  printf '%s' "$p"
}
f=$(real "$full") || exit 4
case $f in "$r"/*) ;; *) exit 3;; esac
[ -f "$f" ] || exit 4`

// $3: the most bytes it may have (exit 2 above). Prints the file, base64 (nothing is trimmed).
export const PLAN_READ_SCRIPT = `${RESOLVE}
[ "$(wc -c < "$f")" -le "$3" ] || exit 2
base64 < "$f" | tr -d '\\n'`

// $3: the branch the root must be on ('': any), $4: the byte length of the file as it was read,
// $5: the commit message. stdin: the file as it was read, then the new one. A file changed since
// it was read (5), a root on another branch (6, printing it), a plan file with local changes
// (7) or not tracked (8), a commit that failed (9, the file as it was, printing git's words):
// nothing is written. A git root commits that file only (commit --only: other staged or
// unstaged work stays as it is); a root with no git just gets the file written.
export const PLAN_WRITE_SCRIPT = `${RESOLVE}
t=$(mktemp -d "\${TMPDIR:-/tmp}/wherdr-plan.XXXXXX") || exit 1
trap 'rm -rf "$t"' EXIT
cat > "$t/in" || exit 1
head -c "$4" "$t/in" > "$t/old"
tail -c +"$(($4 + 1))" "$t/in" > "$t/new"
cmp -s "$t/old" "$f" || exit 5
if [ "$(git -C "$r" rev-parse --show-toplevel 2>/dev/null)" = "$r" ]; then
  cur=$(git -C "$r" symbolic-ref -q --short HEAD)
  if [ -n "$3" ] && [ "$cur" != "$3" ]; then echo "\${cur:-no branch}"; exit 6; fi
  git -C "$r" ls-files --error-unmatch -- "$f" >/dev/null 2>&1 || exit 8
  git -C "$r" diff --quiet -- "$f" && git -C "$r" diff --cached --quiet -- "$f" || exit 7
  cat "$t/new" > "$f" || exit 1
  if ! out=$(git -C "$r" commit --only -m "$5" -- "$f" 2>&1); then
    cat "$t/old" > "$f"
    printf '%s\\n' "$out" | tail -n 3
    exit 9
  fi
  echo "committed $(git -C "$r" rev-parse --short HEAD)"
else
  cat "$t/new" > "$f" || exit 1
  echo written
fi`

export const PLAN_CAP = 2_000_000

export type PlanRead = { text: string } | { why: string }
const readWhy: Record<number, string> = { 2: 'is too large', 3: 'is outside the workspace\'s root', 4: 'was not found' }

// The file under the workspace's root, on its machine: its text, or why not
// (outside the root, symlinks resolved; not a file; too large). An unreachable
// machine or a failing script throws.
export async function readPlanFile(deps: Pick<PmLaunchDeps, 'call' | 'machines'>, ws: Project, file: string, cap = PLAN_CAP): Promise<PlanRead> {
  const r = await exec(deps, machineOn(deps, ws.machine).on, PLAN_READ_SCRIPT, [ws.path, file, String(cap)])
  if (r.code !== null && readWhy[r.code]) return { why: `${file} ${readWhy[r.code]}` }
  if (r.code !== 0) throw new HerdrError('core', `Could not read ${file} on the workspace's machine`)
  const raw = Buffer.from(r.out, 'base64'), text = raw.toString('utf8')
  // Written back as text: a file that is not UTF-8 would change.
  return Buffer.from(text, 'utf8').equals(raw) ? { text } : { why: `${file} is not UTF-8 text` }
}

// The write script's arguments and input: the plan file as it was read and as it will be.
export function planWriteCall(ws: Pick<Project, 'path'>, file: string, base: string, before: string, after: string, message: string) {
  return { args: [ws.path, file, base, String(Buffer.byteLength(before)), message], input: before + after }
}

// What a write's exit code means: 'again' (changed meanwhile: try later) or why it was skipped.
export function planWriteResult(code: number | null, out: string, file: string, base: string): { done: string } | { again: true } | { skipped: string } {
  if (code === 0) return { done: out.startsWith('committed ') ? `committed ${out.slice(10).trim()}` : 'written, the root has no git' }
  if (code === 5 || code === null) return { again: true }
  const why: Record<number, string> = {
    3: `${file} is outside the workspace's root`, 4: `${file} was not found`, 7: `${file} has local changes`, 8: `${file} is not tracked by git`,
    6: `the root is on branch ${out || '?'}${base ? ` (not ${base})` : ''}`, 9: `git could not commit it: ${out.split('\n').pop() ?? ''}`.trim(),
  }
  const skipped = why[code]
  if (!skipped) throw new HerdrError('core', `Could not write ${file} on the workspace's machine (exit ${code})`)
  return { skipped }
}

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
let chain: Promise<unknown> = Promise.resolve()

// A done task's refs ticked in its feature's plan file, once. Done with its
// whole workflow (not abandoned), as `mergeAfter` waits count it. A result is
// kept on the task (planTick): a skip is logged, and the workspace's
// coordinator told once at its next wake. An unreachable machine, or a file
// changed while it was read, leaves it for the next pass.
export function tickPlanFile(deps: PmLaunchDeps, id: string): Promise<void> {
  // One at a time: two done tasks never write the same file at once.
  const run = chain.catch(() => {}).then(() => tick(deps, id))
  chain = run
  return run
}

async function tick(deps: PmLaunchDeps, id: string) {
  const { store } = deps
  const task = await store.task(id)
  if (!task?.refs?.length || !task.feature || task.planTick || !task.step?.done || task.step.abandoned) return
  const projects = await store.projects()
  const p = projects.find(x => x.key === task.project), ws = p && workspaceOf(p, projects)
  const feature = await store.task(task.feature), file = feature?.plan?.file
  if (!p || !ws || !file) return
  const shown = shownTaskId(projects, id), now = Date.now()
  const root = membersOf(ws.key, projects).find(m => isRootMember(m, ws))
  const effective = root ? effectiveProject(root, ws) : undefined
  const skip = async (why: string) => {
    await store.updateTask(id, t => ({ ...t, planTick: { at: now, skipped: why } }), { by: 'engine', text: `plan: ${task.refs!.join(', ')} not ticked in ${file}: ${why}` })
    await wakeCoordinators(deps, task, `${shown} is done, but its plan lines ${task.refs!.join(', ')} are not ticked in ${file}: ${why}. wherdr ticks them only when that is safe, never over local work: tell the user, who can fix it (commit or discard the change, or switch the root back to its branch) and tick them by hand, or leave them.`, now).catch(() => {})
  }
  const read = await readPlanFile(deps, ws, file)
  if ('why' in read) return skip(read.why)
  // The merge's commit, when the task's merge step kept it.
  const t = await store.workflow(p.key), plan = t ? taskPlan(t, task, p) : []
  const sha = plan.map(s => (s.action && endsMerged(s.action.kind) ? task.step!.proofs[s.id]?.commit : undefined)).findLast(Boolean)?.slice(0, 7)
  const ticked = tickPlan(read.text, task.refs, { task: shown, date: today(), ...(sha ? { sha } : {}) })
  const left = skippedText(ticked.skipped)
  if (!ticked.ticked.length) return void await store.updateTask(id, x => ({ ...x, planTick: { at: now, ticked: [] } }), { by: 'engine', text: left })
  const message = planCommitMessage(effective ? effective.commitMessage : ws.shared?.commitMessage, shownTaskId(projects, feature!.id), { ...task, id: shown }, ticked.ticked)
  const call = planWriteCall(ws, file, effective?.base ?? '', read.text, ticked.text, message)
  const w = await exec(deps, machineOn(deps, ws.machine).on, PLAN_WRITE_SCRIPT, call.args, call.input)
  const result = planWriteResult(w.code, w.out, file, effective?.base ?? '')
  if ('again' in result) return
  if ('skipped' in result) return skip(result.skipped)
  await store.updateTask(id, x => ({ ...x, planTick: { at: now, ticked: ticked.ticked } }), { by: 'engine', text: [`plan: ticked ${ticked.ticked.join(', ')} in ${file} (${result.done})`, left].filter(Boolean).join('; ') })
}
