// Moves a task in a project's TASKS.md from the Project panel (local or SSH
// machine). Safe write: refused if the file's content no longer matches what
// the app showed (hash), and only the task's lines move (shared/taskEdit.ts).
//
// Compare-and-write is serialized: one wherdr write at a time per file in this
// process (a promise chain), and across processes and machines by a lock
// directory next to the file (`mkdir` is atomic), taken by the write script
// and never removed by another writer.
// The hash is checked inside that lock, right before the rename. The same
// script runs locally and over SSH.
// Limit: an author that does not take the lock (the coordinator editing the
// file) can still write between our last check and the rename; that window is
// a few milliseconds, and its write would then be replaced by ours.
import { execFile } from 'node:child_process'
import type { Pane } from '../../shared/types'
import { type TaskMove, type TaskRef, TASK_MOVES, moveTaskInText } from '../../shared/taskEdit'
import type { ShellExec } from './fsx'
import { HerdrError } from './herdr'
import { target, tasksHash } from './projectBoard'

export const TASKS_WRITE_BYTES = 256 * 1024

// $1 file, $2 expected hash, new content on stdin. Exit codes: 44 missing,
// 45 changed since read, 46 cannot write, 47 lock busy, 48 lock left over.
// The new content is stored first (unique `$$` names: one shell process per
// write), then, under the lock: hash check, copy keeping the file mode,
// rename. The lock holds an owner token; a write removes only a lock whose
// token is its own. A lock older than a minute is never removed
// automatically (two writers could both judge it stale and both enter): the
// write is refused and the user removes the folder (explicit recovery).
export const WRITE_TASKS_SCRIPT = `f="$1"; want="$2"; lock="$f.wherdr-lock"
in="$f.wherdr-$$.in"; tmp="$f.wherdr-$$"; held=; tok="$$.$(date +%s).$(od -An -N8 -tx1 /dev/urandom 2>/dev/null | tr -d ' \\n')"
h() { if command -v sha256sum >/dev/null 2>&1; then sha256sum < "$1"; else shasum -a 256 < "$1"; fi | cut -d' ' -f1; }
unlock() { [ -n "$held" ] && [ "$(cat "$lock/owner" 2>/dev/null)" = "$tok" ] && rm -f "$lock/owner" && rmdir "$lock" 2>/dev/null; }
trap 'rm -f "$in" "$tmp"; unlock' EXIT
trap 'exit 1' HUP INT TERM
cat > "$in" || exit 46
[ -f "$f" ] || exit 44
n=0
until mkdir "$lock" 2>/dev/null; do
  [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ] && exit 48
  n=$((n + 1)); [ "$n" -ge 50 ] && exit 47
  sleep 0.1 2>/dev/null || sleep 1
done
held=1
printf '%s' "$tok" > "$lock/owner" || exit 46
[ -f "$f" ] || exit 44
[ "$(h "$f")" = "$want" ] || exit 45
cp -p "$f" "$tmp" 2>/dev/null || exit 46
cat "$in" > "$tmp" || exit 46
mv -f "$tmp" "$f" || exit 46`

// The script on this machine (no SSH).
export const localExec: ShellExec = (script, args = [], opts = {}) => new Promise((resolve) => {
  const child = execFile('sh', ['-c', script, 'sh', ...args], { timeout: opts.timeoutMs || 15000, encoding: 'buffer' }, (err, out, stderr) => resolve({
    code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
    stdout: out,
    stderr: String(stderr || ''),
  }))
  child.stdin?.on('error', () => {})
  child.stdin?.end(opts.input || undefined)
})

const STALE = () => new HerdrError('tasks_changed', 'TASKS.md changed in the meantime: check the list and try again')
const UNWRITABLE = () => new HerdrError('tasks_readonly', 'TASKS.md cannot be written on this machine')

// Compare-and-write of TASKS.md through the script (local or remote shell).
export async function writeTasksFile(exec: ShellExec, file: string, want: string, data: Buffer): Promise<void> {
  const r = await exec(WRITE_TASKS_SCRIPT, [file, want], { input: data, timeoutMs: 20000 })
  if (r.code === 0) return
  if (r.code === 44 || r.code === 45) throw STALE()
  if (r.code === 47) throw new HerdrError('tasks_busy', 'TASKS.md is being written: try again')
  if (r.code === 48) throw new HerdrError('tasks_locked', 'TASKS.md is locked by an interrupted write: remove the folder TASKS.md.wherdr-lock next to it, then try again')
  if (r.code === 255 || r.code === 124) throw new HerdrError('unreachable', 'Machine unreachable')
  throw UNWRITABLE()
}

// One move at a time per file in this process: the read, the check and the
// write of a move all happen before the next one starts.
const chains = new Map<string, Promise<unknown>>()
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) || Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  const done = run.catch(() => {})
  chains.set(key, done)
  done.then(() => { if (chains.get(key) === done) chains.delete(key) })
  return run
}

const ERRORS: Record<string, string> = {
  not_found: 'This task is no longer in TASKS.md: the list was reloaded',
  no_list: 'This list is missing from TASKS.md',
  edge: 'The task is already at the edge of its list',
  same_list: 'The task is already in this list',
}

export function checkMove(body: Record<string, unknown>): { ref: TaskRef, move: TaskMove, hash: string } {
  const move = body.move as TaskMove
  const ref = { list: Number(body.list), index: Number(body.index), text: String(body.text ?? '') }
  const hash = String(body.hash ?? '')
  if (!TASK_MOVES.includes(move) || !Number.isInteger(ref.list) || ref.list < 0 || !Number.isInteger(ref.index) || ref.index < 0
    || !ref.text || ref.text.length > 2000 || !/^[0-9a-f]{64}$/.test(hash)) throw new HerdrError('bad_move', 'Invalid task move')
  return { ref, move, hash }
}

// Reads TASKS.md, checks the hash, applies the move and writes it back.
export async function applyMove(
  io: { read: (file: string) => Promise<Buffer | null>, exec: ShellExec },
  file: string, ref: TaskRef, move: TaskMove, hash: string,
): Promise<{ ok: true, hash: string }> {
  const buf = await io.read(file)
  if (!buf) throw STALE()
  if (buf.length > TASKS_WRITE_BYTES) throw new HerdrError('tasks_too_large', 'TASKS.md is too large to edit from wherdr')
  if (tasksHash(buf) !== hash) throw STALE()
  const md = buf.toString('utf8')
  // Bytes that are not UTF-8 would not survive the round trip: refused.
  if (!Buffer.from(md, 'utf8').equals(buf)) throw new HerdrError('tasks_encoding', 'TASKS.md is not valid UTF-8')
  const res = moveTaskInText(md, ref, move)
  if (!res.ok) throw new HerdrError(`task_${res.error}`, ERRORS[res.error]!)
  const out = Buffer.from(res.text, 'utf8')
  await writeTasksFile(io.exec, file, hash, out)
  return { ok: true, hash: tasksHash(out) }
}

export async function moveProjectTask(pane: Pane, body: Record<string, unknown>): Promise<{ ok: true, hash: string }> {
  const { ref, move, hash } = checkMove(body)
  const t = await target(pane)
  if (!t) throw new HerdrError('no_project', 'project not found')
  const file = `${t.dir}/TASKS.md`
  const read = async (f: string) => {
    const st = await t.m.fs.stat(f).catch(() => null)
    if (!st?.isFile) return null
    if (st.size > TASKS_WRITE_BYTES) throw new HerdrError('tasks_too_large', 'TASKS.md is too large to edit from wherdr')
    return t.m.fs.read(f, 0, st.size)
  }
  return serialized(`${t.m.key}|${file}`, () => applyMove({ read, exec: t.m.exec || localExec }, file, ref, move, hash))
}
