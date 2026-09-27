import { execFile } from 'node:child_process'
import path from 'node:path'
import type { ChangeFile, ChangeLine, ChangeSet, ChangesResponse } from '../../shared/types'
import type { Machine } from './machines'

const STATUS_BYTES = 128 * 1024
const FILE_BYTES = 32 * 1024
const TOTAL_BYTES = 320 * 1024
const MAX_FILES = 100
const MAX_DIFFS = 40

// Le format -z garde les espaces, tabulations et retours à la ligne des noms.
// Une entrée renommée porte deux noms : le nouveau, puis l'ancien.
export function parseStatus(raw: string): { path: string, previousPath?: string, status: string }[] {
  const parts = raw.split('\0')
  const files: { path: string, previousPath?: string, status: string }[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    const entry = parts[i] || ''
    if (entry.length < 4 || entry[2] !== ' ') continue
    const xy = entry.slice(0, 2)
    const file: { path: string, previousPath?: string, status: string } = { path: entry.slice(3), status: xy }
    if (/[RC]/.test(xy)) {
      file.previousPath = parts[++i] || undefined
    }
    files.push(file)
  }
  return files
}

export function parseDiff(raw: string): { lines: ChangeLine[], added: number, deleted: number, binary: boolean } {
  const lines: ChangeLine[] = []
  let added = 0; let deleted = 0; let binary = false
  const source = raw.endsWith('\n') ? raw.slice(0, -1) : raw
  for (const text of source ? source.split('\n') : []) {
    let kind: ChangeLine['kind'] = 'meta'
    if (/^@@/.test(text)) kind = 'hunk'
    else if (/^\+\+\+ /.test(text) || /^--- /.test(text)) kind = 'meta'
    else if (text.startsWith('+')) { kind = 'add'; added++ }
    else if (text.startsWith('-')) { kind = 'del'; deleted++ }
    else if (text.startsWith(' ')) kind = 'context'
    if (/^(Binary files |GIT binary patch)/.test(text)) binary = true
    lines.push({ kind, text })
  }
  return { lines, added, deleted, binary }
}

export function parseNumstat(raw: string): Map<string, { added: number | null, deleted: number | null }> {
  const stats = new Map<string, { added: number | null, deleted: number | null }>()
  const parts = raw.split('\0')
  for (let i = 0; i < parts.length - 1; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(parts[i] || '')
    if (!m) continue
    // En -z, le renommage met un champ vide avant ancien\0nouveau\0.
    const name = m[3] || parts[i + 2]
    if (!m[3]) i += 2
    if (name) stats.set(name, { added: m[1] === '-' ? null : Number(m[1]), deleted: m[2] === '-' ? null : Number(m[2]) })
  }
  return stats
}

type Run = (script: string, args: string[], timeout?: number) => Promise<Buffer>
function runner(m: Machine): Run {
  const remoteExec = m.exec
  if (remoteExec) return async (script, args, timeout = 12000) => {
    const r = await remoteExec(script, args, { timeoutMs: timeout })
    if (r.code !== 0) throw new Error(r.stderr.trim() || `Git : code ${r.code}`)
    return r.stdout
  }
  return (script, args, timeout = 12000) => new Promise((resolve, reject) => {
    execFile('sh', ['-c', script, 'sh', ...args], { timeout, encoding: 'buffer', maxBuffer: 512 * 1024 }, (err, out, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()))
      else resolve(out as Buffer)
    })
  })
}

const git = 'git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.quotePath=false -c diff.external='
const generated = /(^|\/)(?:dist|build|generated|coverage|node_modules|\.nuxt)\/|(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|.*\.min\.(?:js|css)|.*\.map|.*\.generated\.[^/]+)$/i
const emptySet = (): ChangeSet => ({ files: [], truncated: false, count: 0 })

async function fillDiffs(run: Run, root: string, set: ChangeSet, committedRef?: string, hasHead = true) {
  let total = 0
  for (let i = 0; i < set.files.length; i++) {
    const file = set.files[i]!
    if (i >= MAX_DIFFS || total >= TOTAL_BYTES) {
      file.truncated = true; file.summary = 'Diff non chargé (limite de taille)'; set.truncated = true; continue
    }
    if (file.binary) { file.summary = 'Fichier binaire'; continue }
    if (generated.test(file.path)) {
      file.summary = 'Fichier généré ou verrouillage de dépendances'; continue
    }
    const cap = Math.min(FILE_BYTES, TOTAL_BYTES - total)
    const isNew = file.status === '??' || !hasHead
    const script = isNew
      ? `cd "$1" && ${git} diff --no-index --no-ext-diff --unified=3 -- /dev/null "$2" 2>/dev/null | head -c "$3"`
      : committedRef
        ? `cd "$1" && ${git} diff --no-ext-diff --no-textconv --unified=3 "$2"..HEAD -- "$3" 2>/dev/null | head -c "$4"`
        : `cd "$1" && ${git} diff --no-ext-diff --no-textconv --unified=3 HEAD -- "$2" 2>/dev/null | head -c "$3"`
    const args = isNew ? [root, path.posix.join(root, file.path), String(cap + 1)]
      : committedRef ? [root, committedRef, file.path, String(cap + 1)] : [root, file.path, String(cap + 1)]
    const out = await run(script, args)
    const cut = out.length > cap
    const shown = cut ? out.subarray(0, cap).toString('utf8').replace(/[^\n]*$/, '') : out.toString('utf8')
    const parsed = parseDiff(shown)
    file.lines = parsed.lines
    if (file.added === null) file.added = parsed.binary ? null : parsed.added
    if (file.deleted === null) file.deleted = parsed.binary ? null : parsed.deleted
    file.binary = parsed.binary
    file.truncated = cut
    if (parsed.binary) { file.lines = []; file.summary = 'Fichier binaire' }
    if (cut) { file.summary = 'Diff tronqué'; set.truncated = true }
    total += Math.min(out.length, cap)
  }
}

async function fillStats(run: Run, root: string, set: ChangeSet, committedRef?: string, hasHead = true) {
  const cmd = committedRef
    ? `cd "$1" && ${git} diff --numstat -z "$2"..HEAD -- 2>/dev/null | head -c ${STATUS_BYTES + 1}`
    : `cd "$1" && ${git} diff --numstat -z HEAD -- 2>/dev/null | head -c ${STATUS_BYTES + 1}`
  const raw = hasHead ? await run(cmd, committedRef ? [root, committedRef] : [root]) : Buffer.alloc(0)
  const stats = parseNumstat(raw.subarray(0, STATUS_BYTES).toString('utf8'))
  if (raw.length > STATUS_BYTES) set.truncated = true
  for (const f of set.files) {
    let s = stats.get(f.path)
    if (f.status === '??' || !hasHead) {
      const out = await run(`cd "$1" && ${git} diff --no-index --numstat -z -- /dev/null "$2" 2>/dev/null | head -c 4096`, [root, path.posix.join(root, f.path)])
      s = [...parseNumstat(out.toString('utf8')).values()][0]
    }
    if (s) { f.added = s.added; f.deleted = s.deleted; f.binary = s.added === null }
  }
}

function file(path: string, status: string, previousPath?: string): ChangeFile {
  return { path, status, previousPath, added: null, deleted: null, lines: [], binary: false, truncated: false }
}

export async function readChanges(m: Machine, cwd: string, includeCommits = false): Promise<ChangesResponse> {
  const run = runner(m)
  // Le cwd vient du pane serveur, jamais d'un paramètre de chemin du client.
  const rootResult = await run(`cd "$1" 2>/dev/null && ${git} rev-parse --show-toplevel 2>/dev/null || true`, [cwd])
  const root = rootResult.toString('utf8').trim()
  if (!root) return { git: false }
  const branch = (await run(`cd "$1" && ${git} branch --show-current`, [root])).toString('utf8').trim()
  const hasHead = Boolean((await run(`cd "$1" && ${git} rev-parse --verify HEAD 2>/dev/null || true`, [root])).length)
  const raw = await run(`cd "$1" && ${git} status --porcelain=v1 -z --untracked-files=all 2>/dev/null | head -c ${STATUS_BYTES + 1}`, [root], 20000)
  const statusCut = raw.length > STATUS_BYTES
  const working = emptySet()
  const entries = parseStatus(raw.subarray(0, STATUS_BYTES).toString('utf8'))
  working.count = entries.length
  working.truncated = statusCut || entries.length > MAX_FILES
  working.files = entries.slice(0, MAX_FILES).map(e => file(e.path, e.status, e.previousPath))
  await fillStats(run, root, working, undefined, hasHead)
  await fillDiffs(run, root, working, undefined, hasHead)

  const result: ChangesResponse = { git: true, root, branch, working }
  if (!includeCommits) return result
  // Amont de la branche. Pour un worktree sans amont, comparer à main/master
  // local ou distant, sans contact réseau et sans modifier de référence.
  const base = (await run(`cd "$1" && (
    ${git} rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null ||
    { test -f .git && for ref in refs/heads/main refs/heads/master refs/remotes/origin/main refs/remotes/origin/master; do
      test "$ref" = "refs/heads/$2" && continue
      ${git} show-ref --verify --quiet "$ref" && { echo "$ref"; break; }
    done; }
  )`, [root, branch])).toString('utf8').trim().split('\n')[0] || ''
  result.comparison = base || null
  result.committed = null
  result.commits = null
  if (!base) return result
  const count = (await run(`cd "$1" && ${git} rev-list --count "$2"..HEAD`, [root, base])).toString('utf8').trim()
  result.commits = Number(count) || 0
  const names = await run(`cd "$1" && ${git} diff --name-only -z "$2"..HEAD -- 2>/dev/null | head -c ${STATUS_BYTES + 1}`, [root, base], 20000)
  const committed = emptySet()
  const paths = names.subarray(0, STATUS_BYTES).toString('utf8').split('\0').filter(Boolean)
  committed.count = paths.length
  committed.truncated = names.length > STATUS_BYTES || paths.length > MAX_FILES
  committed.files = paths.slice(0, MAX_FILES).map(p => file(p, 'commit'))
  await fillStats(run, root, committed, base)
  await fillDiffs(run, root, committed, base)
  result.committed = committed
  return result
}
