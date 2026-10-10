// Read-only file browser of an agent's folder: listing and preview, confined to
// the Git root containing the pane's folder (or the folder itself). Same
// shell scripts on the local disk and on a remote machine; paths only ever go
// in positional arguments, and every resolved path (symlinks included) must
// stay under the root. Nothing here writes.
import { execFile } from 'node:child_process'
import path from 'node:path'
import type { FileEntry, FilePreview, FilesListing } from '../../shared/types'
import { gitToplevel } from './changes'
import { HerdrError } from './herdr'
import type { Machine } from './machines'

const MAX_ENTRIES = 2000
const TEXT_BYTES = 256 * 1024
const IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
}

// Physical root, then the requested folder resolved under it (exit 5 outside).
const RESOLVE = `root=$(cd "$1" 2>/dev/null && pwd -P) || { echo "folder not found" >&2; exit 3; }
under() { case "$1/" in "\${root%/}/"*) return 0 ;; esac; return 1; }`

// NUL-separated: the physical root and folder, then "<d|f|o><l| > <name>" per
// entry (folders first, so a cut keeps them; "+" when cut), then "=" and the
// sizes of the plain files (not symlinks: their target may lie outside), one
// `stat` for all. $4: the pane's folder, to open on it (root if outside).
export const LIST_SCRIPT = `${RESOLVE}
if [ -n "$4" ]; then
  dir=$(cd "$4" 2>/dev/null && pwd -P) && under "$dir" || dir=$root
else
  dir=$(cd "$root" && cd -- "./$2" 2>/dev/null && pwd -P) || { echo "not found" >&2; exit 4; }
  under "$dir" || { echo "outside" >&2; exit 5; }
fi
cd "$dir" || exit 4
[ -r . ] || { echo "permission denied" >&2; exit 7; }
printf '%s\\0%s\\0' "$root" "$dir"
max=$3; n=0
set --
for pass in d o; do
  for f in * .[!.]* ..?*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    if [ -d "$f" ]; then t=d; elif [ -f "$f" ]; then t=f; else t=o; fi
    if [ "$pass" = d ]; then [ "$t" = d ] || continue; else [ "$t" != d ] || continue; fi
    n=$((n + 1)); [ "$n" -gt "$max" ] && { printf '+\\0'; break 2; }
    if [ -L "$f" ]; then l=l; else l=' '; [ "$t" = f ] && set -- "$@" "$f"; fi
    printf '%s%s %s\\0' "$t" "$l" "$f"
  done
done
printf '=\\0'
[ "$#" -gt 0 ] || exit 0
if stat -f %z / >/dev/null 2>&1; then stat -f %z -- "$@"; else stat -c %s -- "$@"; fi 2>/dev/null
exit 0`

// "<size>\\n" then at most $3 bytes of the file. Symlinks resolved one link at
// a time (readlink, cd -P: realpath is missing before macOS 13).
export const READ_SCRIPT = `${RESOLVE}
case "$2" in */*) d=\${2%/*} ;; *) d=. ;; esac
b=\${2##*/}
dir=$(cd "$root" && cd -- "./$d" 2>/dev/null && pwd -P) || { echo "not found" >&2; exit 4; }
f="$dir/$b"; i=0
while [ -L "$f" ]; do
  i=$((i + 1)); [ "$i" -gt 40 ] && { echo "not found" >&2; exit 4; }
  t=$(readlink -- "$f") || exit 4
  case "$t" in /*) f=$t ;; *) f="\${f%/*}/$t" ;; esac
  p=\${f%/*}
  dir=$(cd -P -- "\${p:-/}" 2>/dev/null && pwd -P) || { echo "not found" >&2; exit 4; }
  f="\${dir%/}/\${f##*/}"
done
[ -e "$f" ] || { echo "not found" >&2; exit 4; }
under "$f" || { echo "outside" >&2; exit 5; }
[ -f "$f" ] || { echo "not a file" >&2; exit 6; }
[ -r "$f" ] || { echo "permission denied" >&2; exit 7; }
s=$(wc -c < "$f") || exit 4
echo $s
head -c "$3" < "$f"`

type Exec = (script: string, args: string[]) => Promise<{ code: number | null, stdout: Buffer, stderr: string }>
function executor(m: Machine): Exec {
  const remote = m.exec
  if (remote) return (script, args) => remote(script, args, { timeoutMs: 15000 })
  return (script, args) => new Promise((resolve) => {
    execFile('sh', ['-c', script, 'sh', ...args], { timeout: 15000, encoding: 'buffer', maxBuffer: IMAGE_BYTES + 64 * 1024 }, (err, out, stderr) => {
      // Killed at the timeout: 124, like timeout(1) on a remote machine.
      const e = err as (Error & { code?: unknown, killed?: boolean }) | null
      const code = !e ? 0 : e.killed ? 124 : typeof e.code === 'number' ? e.code : 1
      resolve({ code, stdout: out as Buffer, stderr: String(stderr || '') })
    })
  })
}

async function run(m: Machine, script: string, args: string[]) {
  const r = await executor(m)(script, args)
  if (r.code === 0) return r.stdout
  if (r.code === 3) throw new HerdrError('bad_cwd', 'This agent’s folder is unknown')
  if (r.code === 4) throw new HerdrError('not_found', 'File not found')
  if (r.code === 5) throw new HerdrError('outside', 'Outside the project folder')
  if (r.code === 6) throw new HerdrError('not_file', 'Not a file')
  if (r.code === 7) throw new HerdrError('denied', 'Permission denied')
  if (r.code === 124) throw new HerdrError('timeout', 'The folder took too long to read')
  if (r.code === 255 || r.code === null) throw new HerdrError('unreachable', 'Machine unreachable')
  throw new HerdrError('remote', r.stderr.trim().split('\n').pop() || `code ${r.code}`)
}

// Path relative to the root, from the client: no absolute path, no "..".
export function cleanRelative(p: unknown): string {
  const raw = String(p ?? '').replace(/\\/g, '/')
  if (raw.startsWith('/') || raw.includes('\0')) throw new HerdrError('outside', 'Outside the project folder')
  const n = path.posix.normalize(raw || '.').replace(/\/+$/, '')
  if (n === '..' || n.startsWith('../')) throw new HerdrError('outside', 'Outside the project folder')
  return n === '.' ? '' : n
}

export function parseListing(raw: Buffer): { root: string, dir: string, entries: FileEntry[], truncated: boolean } {
  const parts = raw.toString('utf8').split('\0')
  const root = parts[0] || ''
  const dir = parts[1] || ''
  const entries: FileEntry[] = []
  const plain: FileEntry[] = []
  let truncated = false
  let i = 2
  for (; i < parts.length; i++) {
    const p = parts[i]!
    if (p === '=') break
    if (p === '+') { truncated = true; continue }
    const m = /^([dfo])([l ]) (.+)$/s.exec(p)
    if (!m) continue
    const e: FileEntry = { name: m[3]!, kind: m[1] === 'd' ? 'dir' : m[1] === 'f' ? 'file' : 'other', size: null, link: m[2] === 'l' }
    entries.push(e)
    if (e.kind === 'file' && !e.link) plain.push(e)
  }
  // One size per plain file, in order; a file gone in between shifts them all: none then.
  const sizes = parts.slice(i + 1).join('').split('\n').filter(l => /^\d+$/.test(l)).map(Number)
  if (sizes.length === plain.length) plain.forEach((e, k) => { e.size = sizes[k]! })
  entries.sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return { root, dir, entries, truncated }
}

// Browsed root: the Git root containing the folder, otherwise the folder.
async function rootOf(m: Machine, cwd: string) {
  return (await gitToplevel(m, cwd)) || cwd
}

// `rel` null: the pane's own folder (the root when it lies outside).
export async function listFiles(m: Machine, cwd: string, rel: string | null, opts: { max?: number } = {}): Promise<FilesListing> {
  const root = await rootOf(m, cwd)
  const args = rel === null ? [root, '', String(opts.max ?? MAX_ENTRIES), cwd] : [root, cleanRelative(rel), String(opts.max ?? MAX_ENTRIES)]
  const out = parseListing(await run(m, LIST_SCRIPT, args))
  const rp = path.posix.relative(out.root, out.dir)
  return { root: out.root, path: rp.startsWith('..') ? '' : rp, entries: out.entries, truncated: out.truncated }
}

const isText = (b: Buffer) => !b.subarray(0, 8192).includes(0)

// Where to cut `b` to at most `max` bytes: after the last line ending, or,
// for one long line (minified file), before a UTF-8 character starts.
export function cutAt(b: Buffer, max: number) {
  const nl = b.lastIndexOf(10, max - 1)
  if (nl >= 0) return nl + 1
  let i = max
  while (i > 0 && (b[i]! & 0xC0) === 0x80) i--
  return i
}

export async function readFilePreview(m: Machine, cwd: string, rel: unknown): Promise<FilePreview> {
  const root = await rootOf(m, cwd)
  const p = cleanRelative(rel)
  if (!p) throw new HerdrError('not_file', 'Not a file')
  const mime = IMAGE_TYPES[path.posix.extname(p).slice(1).toLowerCase()]
  const out = await run(m, READ_SCRIPT, [root, p, String(mime ? IMAGE_BYTES + 1 : TEXT_BYTES + 1)])
  const nl = out.indexOf(10)
  const size = Number(out.subarray(0, nl).toString('utf8')) || 0
  const body = out.subarray(nl + 1)
  if (mime) {
    if (size > IMAGE_BYTES) return { path: p, size, kind: 'large', truncated: true }
    return { path: p, size, kind: 'image', dataUrl: `data:${mime};base64,${body.toString('base64')}`, truncated: false }
  }
  if (!isText(body)) return { path: p, size, kind: 'binary', truncated: false }
  const truncated = body.length > TEXT_BYTES
  const text = (truncated ? body.subarray(0, cutAt(body, TEXT_BYTES)) : body).toString('utf8')
  return { path: p, size, kind: 'text', text, truncated }
}
