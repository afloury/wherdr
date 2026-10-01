// File access on a machine (transcripts, folders, photos): the local
// disk, or a remote machine's through shell commands passed over the
// multiplexed SSH connection (see machines.ts). Same operations on both sides,
// in POSIX sh + BSD (macOS) or GNU (Linux) stat.
import fs from 'node:fs'
import path from 'node:path'

const fsp = fs.promises

export interface FsStat { size: number, mtimeMs: number, isFile: boolean, isDir: boolean }

export interface MachineFs {
  stat: (p: string) => Promise<FsStat> // rejette si absent
  statMany: (ps: string[]) => Promise<(FsStat | null)[]>
  readdir: (p: string) => Promise<string[]>
  readFile: (p: string) => Promise<string>
  // `len` bytes from `start` (fewer at the end of the file).
  read: (p: string, start: number, len: number, timeoutMs?: number) => Promise<Buffer>
}

// ---------------------------------------------------------------- disque local
const toStat = (st: fs.Stats): FsStat => ({ size: st.size, mtimeMs: st.mtimeMs, isFile: st.isFile(), isDir: st.isDirectory() })

export const localFs: MachineFs = {
  stat: async p => toStat(await fsp.stat(p)),
  statMany: ps => Promise.all(ps.map(p => fsp.stat(p).then(toStat, () => null))),
  readdir: p => fsp.readdir(p),
  readFile: p => fsp.readFile(p, 'utf8'),
  async read(p, start, len) {
    const fh = await fsp.open(p, 'r')
    try {
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, start)
      return bytesRead < len ? buf.subarray(0, bytesRead) : buf
    } finally { await fh.close() }
  },
}

// ---------------------------------------------------------------- shell distant
export interface ExecResult { code: number | null, stdout: Buffer, stderr: string }
// Runs `script` (sh) with its positional arguments ($1, $2…) on the machine.
export type ShellExec = (script: string, args?: string[], opts?: { input?: Buffer, timeoutMs?: number }) => Promise<ExecResult>

export class FsError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

// Shell quoting (arguments passed as is, never interpreted).
export const shq = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`

// BSD (macOS) or GNU `stat`: one "size mtime type" line per file, "x" if missing.
export const STAT_SCRIPT = `if stat -f %z / >/dev/null 2>&1; then bsd=1; else bsd=; fi
for f; do
  if [ ! -e "$f" ]; then echo x
  elif [ -n "$bsd" ]; then stat -f '%z %m %HT' "$f" 2>/dev/null || echo x
  else stat -c '%s %Y %F' "$f" 2>/dev/null || echo x; fi
done`

export function parseStatLine(line: string): FsStat | null {
  const m = /^(\d+) (\d+) (.+)$/.exec(String(line || '').trim())
  if (!m) return null
  const type = m[3]!.toLowerCase()
  return { size: Number(m[1]), mtimeMs: Number(m[2]) * 1000, isFile: type.includes('regular'), isDir: type.includes('directory') }
}

export function createShellFs(exec: ShellExec, opts: { statTtlMs?: number } = {}): MachineFs {
  const ttl = opts.statTtlMs ?? 700
  // Small cache (and grouping of simultaneous requests): the previews, the
  // model and the open conversation each run their `stat` every second.
  const statCache = new Map<string, { at: number, v: Promise<FsStat | null> }>()

  async function run(script: string, args: string[], timeoutMs = 15000, input?: Buffer) {
    const r = await exec(script, args, { timeoutMs, input })
    if (r.code !== 0) throw new FsError('remote', (r.stderr || `code ${r.code}`).trim().split('\n').pop() || 'failed')
    return r.stdout
  }

  async function statMany(ps: string[]): Promise<(FsStat | null)[]> {
    const now = Date.now()
    const out: (Promise<FsStat | null> | null)[] = ps.map((p) => {
      const c = statCache.get(p)
      return c && now - c.at < ttl ? c.v : null
    })
    const missing = ps.filter((_, i) => !out[i])
    if (missing.length) {
      const batch = run(STAT_SCRIPT, missing).then(b => b.toString('utf8').split('\n'))
      missing.forEach((p, i) => {
        const v = batch.then(lines => parseStatLine(lines[i] || ''))
        v.catch(() => statCache.delete(p))
        statCache.set(p, { at: now, v })
      })
      if (statCache.size > 2000) {
        for (const [k, c] of statCache) if (now - c.at >= ttl) statCache.delete(k)
      }
      ps.forEach((p, i) => { if (!out[i]) out[i] = statCache.get(p)!.v })
    }
    return Promise.all(out as Promise<FsStat | null>[])
  }

  return {
    async stat(p) {
      const [s] = await statMany([p])
      if (!s) throw new FsError('ENOENT', `introuvable : ${p}`)
      return s
    },
    statMany,
    async readdir(p) {
      const b = await run('cd "$1" && ls -1A', [p])
      return b.toString('utf8').split('\n').filter(Boolean)
    },
    async readFile(p) {
      return (await run('cat "$1"', [p])).toString('utf8')
    },
    async read(p, start, len, timeoutMs) {
      if (len <= 0) return Buffer.alloc(0)
      // tail -c +N jumps straight to byte N (regular file); head cuts.
      return run('tail -c +"$2" "$1" | head -c "$3"', [p, String(start + 1), String(len)], timeoutMs || 60000)
    },
  }
}

// ---------------------------------------------------------------- dossiers
export interface DirEntryRaw { name: string, git: boolean }

// Visible subfolders of a folder, with "is a Git repository".
export const LIST_DIRS_SCRIPT = `cd "$1" || exit 1
for d in * ; do
  [ -d "$d" ] || continue
  [ "$d" = node_modules ] && continue
  if [ -e "$d/.git" ]; then echo "g $d"; else echo "d $d"; fi
done`

export function parseDirList(out: string): DirEntryRaw[] {
  return String(out || '').split('\n').filter(l => /^[gd] ./.test(l)).map(l => ({ name: l.slice(2), git: l[0] === 'g' }))
}

export async function listDirsLocal(dir: string): Promise<DirEntryRaw[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const out: DirEntryRaw[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
    let git = false
    try {
      await fsp.access(path.join(dir, e.name, '.git'))
      git = true
    } catch { /* not a repository */ }
    out.push({ name: e.name, git })
  }
  return out
}
