// Read-only file browser of an agent's folder: listing and preview, confined to
// the Git root containing the pane's folder (or the folder itself). Same
// shell scripts on the local disk and on a remote machine; paths only ever go
// in positional arguments, and every resolved path (symlinks included) must
// stay under the root. Nothing here writes.
//
// A file path written in a conversation (shared/filePaths.ts) is previewed and
// downloaded the same way, with the machine's home folder as the root, like
// Reveal in Finder (server/utils/reveal.ts).
import { execFile } from 'node:child_process'
import path from 'node:path'
import type { FileEntry, FilePreview, FilesListing } from '../../shared/types'
import { posixResolve, resolveAgentPath } from '../../shared/filePaths'
import { gitToplevel } from './changes'
import { HerdrError } from './herdr'
import type { Machine } from './machines'

const MAX_ENTRIES = 2000
const TEXT_BYTES = 256 * 1024
const IMAGE_BYTES = 2 * 1024 * 1024
export const DOWNLOAD_BYTES = 50 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
}
// A PDF: its extension, and its signature in the first kilobyte (where
// readers look for it). Shown by the browser's own viewer, up to DOWNLOAD_BYTES.
const PDF_HEAD = 1024
export const isPdf = (name: string, head: Buffer) =>
  path.posix.extname(name).toLowerCase() === '.pdf' && head.subarray(0, PDF_HEAD).includes('%PDF-')

// Videos played by the browser's own <video>, streamed in pieces of at most
// VIDEO_CHUNK bytes (Range requests), so any size plays without being held
// in memory. A video: its extension, and its container's signature (WebM's
// EBML header, or an MP4/QuickTime box at byte 4).
export const VIDEO_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }
export const VIDEO_CHUNK = 2 * 1024 * 1024
const VIDEO_HEAD = 12
const MP4_BOXES = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'])
export const videoType = (name: string) => VIDEO_TYPES[path.posix.extname(name).slice(1).toLowerCase()]
export function isVideo(name: string, head: Buffer) {
  const type = videoType(name)
  if (!type || head.length < 8) return false
  if (type === 'video/webm') return head.readUInt32BE(0) === 0x1A45DFA3
  return MP4_BOXES.has(head.subarray(4, 8).toString('latin1'))
}

// Bytes asked by a Range header, at most `max` of them (a browser asking
// "bytes=0-" gets the first piece and asks for the next). No header: the
// first piece. null: nothing to serve (416). Several ranges: the first.
export function parseRange(header: string | undefined, size: number, max = VIDEO_CHUNK): { start: number, end: number } | null {
  if (size <= 0) return null
  const cap = (start: number, end: number) => ({ start, end: Math.min(end, size - 1, start + max - 1) })
  if (!header) return cap(0, size - 1)
  const m = /^bytes=\s*(\d*)-(\d*)/i.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return null
  if (!m[1]) {
    const n = Number(m[2])
    return n > 0 ? cap(Math.max(0, size - n), size - 1) : null
  }
  const start = Number(m[1])
  const end = m[2] ? Number(m[2]) : size - 1
  if (start >= size || end < start) return null
  return cap(start, end)
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
e=$(LC_ALL=C ls -A 2>&1 >/dev/null) || {
  case "$e" in *"not permitted"*) [ "$(uname -s)" = Darwin ] && exit 8 ;; esac
  echo "permission denied" >&2; exit 7
}
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

// The file $2 resolved under the root into $f, then "<size>\\n" printed.
// Symlinks resolved one link at a time (readlink, cd -P: realpath is missing
// before macOS 13).
const FILE_SIZE = `${RESOLVE}
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
s=$(($s))
echo $s`

// "<size>\\n" then at most $3 bytes of the file; with $4 set, the size alone
// when the file has $3 bytes or more (a download refused, nothing sent).
export const READ_SCRIPT = `${FILE_SIZE}
[ -n "$4" ] && [ "$s" -ge "$3" ] && exit 0
head -c "$3" < "$f"`

// "<size>\\n" then at most $4 bytes from byte $3 (a video played in pieces):
// tail seeks in a regular file, nothing before $3 is read.
export const RANGE_SCRIPT = `${FILE_SIZE}
[ "$3" -lt "$s" ] || exit 0
tail -c +$(($3 + 1)) < "$f" | head -c "$4"`

export const MACOS_SSH_DENIED = 'macOS blocks access to this folder. On the Mac: System Settings › General › Sharing › Remote Login ⓘ › “Allow full disk access for remote users”.'
export const MACOS_LOCAL_DENIED = 'macOS blocks access to this folder. Allow the app that runs wherdr in System Settings › Privacy & Security › Full Disk Access.'

type Exec = (script: string, args: string[]) => Promise<{ code: number | null, stdout: Buffer, stderr: string }>
interface RunOpts { timeoutMs?: number, maxBytes?: number }
function executor(m: Machine, { timeoutMs = 15000, maxBytes = IMAGE_BYTES }: RunOpts = {}): Exec {
  const remote = m.exec
  if (remote) return (script, args) => remote(script, args, { timeoutMs })
  return (script, args) => new Promise((resolve) => {
    execFile('sh', ['-c', script, 'sh', ...args], { timeout: timeoutMs, encoding: 'buffer', maxBuffer: maxBytes + 64 * 1024 }, (err, out, stderr) => {
      // Killed at the timeout: 124, like timeout(1) on a remote machine.
      const e = err as (Error & { code?: unknown, killed?: boolean }) | null
      const code = !e ? 0 : e.killed ? 124 : typeof e.code === 'number' ? e.code : 1
      resolve({ code, stdout: out as Buffer, stderr: String(stderr || '') })
    })
  })
}

async function run(m: Machine, script: string, args: string[], opts?: RunOpts) {
  const r = await executor(m, opts)(script, args)
  if (r.code === 0) return r.stdout
  if (r.code === 3) throw new HerdrError('bad_cwd', 'This agent’s folder is unknown')
  if (r.code === 4) throw new HerdrError('not_found', 'File not found')
  if (r.code === 5) throw new HerdrError('outside', 'Outside the project folder')
  if (r.code === 6) throw new HerdrError('not_file', 'Not a file')
  if (r.code === 7) throw new HerdrError('denied', 'Permission denied')
  // macOS privacy protection (Documents, Desktop…): `[ -r . ]` passes, the listing is refused.
  if (r.code === 8) throw new HerdrError('denied', m.exec ? MACOS_SSH_DENIED : MACOS_LOCAL_DENIED)
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

// Root and path under it of a file written in a conversation: resolved against
// the agent's folder, and under the machine's home folder (checked again on
// the machine once symlinks are resolved).
export function writtenTarget(m: Machine, cwd: string | null | undefined, written: unknown): { root: string, rel: string, abs: string } {
  const w = String(written ?? '')
  const abs = w.length > 1024 ? null : resolveAgentPath(w, cwd, m.home)
  if (!abs) throw new HerdrError('outside_home', 'Only files in your home folder can be shown')
  const root = posixResolve('/', m.home)
  const rel = path.posix.relative(root, abs)
  if (!rel) throw new HerdrError('not_file', 'Not a file')
  return { root, rel, abs }
}

// Size and first `max` bytes of a file (`whole`: no bytes at all when it has `max` or more).
async function readHead(m: Machine, root: string, rel: string, max: number, opts?: RunOpts & { whole?: boolean }) {
  const out = await run(m, READ_SCRIPT, [root, rel, String(max), ...(opts?.whole ? ['1'] : [])], opts)
  const nl = out.indexOf(10)
  return { size: Number(out.subarray(0, nl).toString('utf8')) || 0, body: out.subarray(nl + 1) }
}

// `shown`: the path given back to the client (relative to the project in the
// file browser, absolute for a path written in a conversation).
async function previewAt(m: Machine, root: string, rel: string, shown: string): Promise<FilePreview> {
  const ext = path.posix.extname(rel).slice(1).toLowerCase()
  const mime = IMAGE_TYPES[ext]
  const video = VIDEO_TYPES[ext]
  const { size, body } = await readHead(m, root, rel, mime ? IMAGE_BYTES + 1 : ext === 'pdf' ? PDF_HEAD : video ? VIDEO_HEAD : TEXT_BYTES + 1)
  if (video) return { path: shown, size, kind: isVideo(rel, body) ? 'video' : 'binary', truncated: false }
  if (ext === 'pdf') {
    if (!isPdf(rel, body)) return { path: shown, size, kind: 'binary', truncated: false }
    return { path: shown, size, kind: size > DOWNLOAD_BYTES ? 'large' : 'pdf', truncated: false }
  }
  if (mime) {
    if (size > IMAGE_BYTES) return { path: shown, size, kind: 'large', truncated: true }
    return { path: shown, size, kind: 'image', dataUrl: `data:${mime};base64,${body.toString('base64')}`, truncated: false }
  }
  if (!isText(body)) return { path: shown, size, kind: 'binary', truncated: false }
  const truncated = body.length > TEXT_BYTES
  const text = (truncated ? body.subarray(0, cutAt(body, TEXT_BYTES)) : body).toString('utf8')
  return { path: shown, size, kind: 'text', text, truncated }
}

export async function readFilePreview(m: Machine, cwd: string, rel: unknown): Promise<FilePreview> {
  const p = cleanRelative(rel)
  if (!p) throw new HerdrError('not_file', 'Not a file')
  return previewAt(m, await rootOf(m, cwd), p, p)
}

export async function readWrittenPreview(m: Machine, cwd: string | null | undefined, written: unknown): Promise<FilePreview> {
  const t = writtenTarget(m, cwd, written)
  return previewAt(m, t.root, t.rel, t.abs)
}

// The whole file, for a download: refused beyond DOWNLOAD_BYTES rather than cut.
async function bytesAt(m: Machine, root: string, rel: string) {
  const { size, body } = await readHead(m, root, rel, DOWNLOAD_BYTES + 1, { timeoutMs: 120000, maxBytes: DOWNLOAD_BYTES + 1, whole: true })
  if (size > DOWNLOAD_BYTES || body.length > DOWNLOAD_BYTES) throw new HerdrError('too_large', 'File too large to download (50 MB max)')
  return { name: path.posix.basename(rel), body }
}

export async function readFileBytes(m: Machine, cwd: string, rel: unknown) {
  const p = cleanRelative(rel)
  if (!p) throw new HerdrError('not_file', 'Not a file')
  return bytesAt(m, await rootOf(m, cwd), p)
}

export async function readWrittenBytes(m: Machine, cwd: string | null | undefined, written: unknown) {
  const t = writtenTarget(m, cwd, written)
  return bytesAt(m, t.root, t.rel)
}

// One piece of a video, as asked by a Range header, with the file's size.
// One call reads both; only a suffix ("the last N bytes") needs the size
// first. `range` null: nothing to serve (416).
type Piece = { name: string, size: number, range: { start: number, end: number } | null, body: Buffer }
async function rangeAt(m: Machine, root: string, rel: string, header: string | undefined): Promise<Piece> {
  const name = path.posix.basename(rel)
  let want = /^\s*bytes=\s*-/i.test(header || '') ? null : parseRange(header, Number.MAX_SAFE_INTEGER)
  if (!want) {
    const { size } = await readHead(m, root, rel, 0, { whole: true })
    want = parseRange(header, size)
    if (!want) return { name, size, range: null, body: Buffer.alloc(0) }
  }
  const len = want.end - want.start + 1
  const out = await run(m, RANGE_SCRIPT, [root, rel, String(want.start), String(len)], { timeoutMs: 60000, maxBytes: len })
  const nl = out.indexOf(10)
  const size = Number(out.subarray(0, nl).toString('utf8')) || 0
  const body = out.subarray(nl + 1, nl + 1 + len)
  if (want.start >= size || !body.length) return { name, size, range: null, body: Buffer.alloc(0) }
  return { name, size, range: { start: want.start, end: want.start + body.length - 1 }, body }
}

export async function readFileRange(m: Machine, cwd: string, rel: unknown, header: string | undefined) {
  const p = cleanRelative(rel)
  if (!p) throw new HerdrError('not_file', 'Not a file')
  return rangeAt(m, await rootOf(m, cwd), p, header)
}

export async function readWrittenRange(m: Machine, cwd: string | null | undefined, written: unknown, header: string | undefined) {
  const t = writtenTarget(m, cwd, written)
  return rangeAt(m, t.root, t.rel, header)
}

// Content-Disposition of a download (or of a PDF shown `inline`): an ASCII
// fallback, then the real name (RFC 6266 / 5987), so accents and spaces survive.
export function attachmentHeader(name: string, type: 'attachment' | 'inline' = 'attachment'): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download'
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
