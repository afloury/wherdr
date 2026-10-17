// Moves a task in a project's TASKS.md from the Project panel (local or SSH
// machine). Safe write: the file is read again just before, refused if its
// content no longer matches what the app showed (hash), checked once more
// right before an atomic rename, and only the task's lines move
// (shared/taskEdit.ts).
import fs from 'node:fs'
import type { Pane } from '../../shared/types'
import { type TaskMove, type TaskRef, TASK_MOVES, moveTaskInText } from '../../shared/taskEdit'
import { HerdrError } from './herdr'
import { target, tasksHash } from './projectBoard'

const fsp = fs.promises
export const TASKS_WRITE_BYTES = 256 * 1024

// Remote write: $1 file, $2 expected hash, new content on stdin.
// 44 missing, 45 changed since read, 46 cannot write.
export const WRITE_TASKS_SCRIPT = `f="$1"; want="$2"
h() { if command -v sha256sum >/dev/null 2>&1; then sha256sum < "$1"; else shasum -a 256 < "$1"; fi | cut -d' ' -f1; }
[ -f "$f" ] || exit 44
[ "$(h "$f")" = "$want" ] || exit 45
tmp="$f.wherdr-$$"
cp -p "$f" "$tmp" 2>/dev/null || exit 46
cat > "$tmp" || { rm -f "$tmp"; exit 46; }
[ "$(h "$f")" = "$want" ] || { rm -f "$tmp"; exit 45; }
mv -f "$tmp" "$f" || { rm -f "$tmp"; exit 46; }`

const STALE = () => new HerdrError('tasks_changed', 'TASKS.md changed in the meantime: check the list and try again')
const UNWRITABLE = () => new HerdrError('tasks_readonly', 'TASKS.md cannot be written on this machine')

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

// Local write: same steps as the remote script.
async function writeLocal(file: string, want: string, data: Buffer) {
  const cur = await fsp.readFile(file).catch(() => { throw STALE() })
  if (tasksHash(cur) !== want) throw STALE()
  const tmp = `${file}.wherdr-${process.pid}-${Date.now()}`
  try {
    const st = await fsp.stat(file)
    await fsp.writeFile(tmp, data, { mode: st.mode & 0o7777, flag: 'wx' })
    if (tasksHash(await fsp.readFile(file)) !== want) throw STALE()
    await fsp.rename(tmp, file)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    if (e instanceof HerdrError) throw e
    throw UNWRITABLE()
  }
}

export async function moveProjectTask(pane: Pane, body: Record<string, unknown>): Promise<{ ok: true, hash: string }> {
  const { ref, move, hash } = checkMove(body)
  const t = await target(pane)
  if (!t) throw new HerdrError('no_project', 'project not found')
  const file = `${t.dir}/TASKS.md`
  const st = await t.m.fs.stat(file).catch(() => null)
  if (!st?.isFile) throw STALE()
  if (st.size > TASKS_WRITE_BYTES) throw new HerdrError('tasks_too_large', 'TASKS.md is too large to edit from wherdr')
  const buf = await t.m.fs.read(file, 0, st.size)
  if (tasksHash(buf) !== hash) throw STALE()
  const md = buf.toString('utf8')
  // Bytes that are not UTF-8 would not survive the round trip: refused.
  if (!Buffer.from(md, 'utf8').equals(buf)) throw new HerdrError('tasks_encoding', 'TASKS.md is not valid UTF-8')
  const res = moveTaskInText(md, ref, move)
  if (!res.ok) throw new HerdrError(`task_${res.error}`, ERRORS[res.error]!)
  const out = Buffer.from(res.text, 'utf8')
  if (t.m.exec) {
    const r = await t.m.exec(WRITE_TASKS_SCRIPT, [file, hash], { input: out, timeoutMs: 15000 })
    if (r.code === 44 || r.code === 45) throw STALE()
    if (r.code === 255 || r.code === 124) throw new HerdrError('unreachable', 'Machine unreachable')
    if (r.code !== 0) throw UNWRITABLE()
  } else {
    await writeLocal(file, hash, out)
  }
  return { ok: true, hash: tasksHash(out) }
}
