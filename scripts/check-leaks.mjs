#!/usr/bin/env node
// Leak check: gitleaks (if installed) + forbidden patterns read from a local, untracked
// file (.leak-patterns). Scans the content of the git index (tracked or staged files);
// `--staged` only scans staged files (pre-commit hook).
// In a linked worktree (`git worktree add`), .leak-patterns (ignored by git) often only
// exists in the main checkout: we then fall back to that one.
//
// .leak-patterns format (see .leak-patterns.example):
//   # comment
//   <regex>                        forbidden pattern (case-insensitive)
//   <regex>  !! LICENSE, docs/*.md pattern allowed in these files
//   ! <glob>                       file never scanned by the patterns
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PATTERNS_FILE = '.leak-patterns'
const ALWAYS_SKIPPED = ['.leak-patterns', '.leak-patterns.example', 'package-lock.json']

/** Simple glob: `*` = anything but `/`, `**` = anything, `?` = one character. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++ }
    else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

const matchesAny = (file, globs) => globs.some((g) => g.test(file))

/** Parses the pattern file text. Throws a readable error on an invalid regex. */
export function parsePatterns(text) {
  const rules = []
  const skip = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    if (line.startsWith('!') && !line.startsWith('!!')) {
      skip.push(globToRegExp(line.slice(1).trim()))
      return
    }
    const [source, allowed = ''] = line.split(/\s+!!\s+/)
    let regex
    try { regex = new RegExp(source.trim(), 'gi') }
    catch (e) { throw new Error(`${PATTERNS_FILE}:${i + 1}: invalid regex (${e.message})`) }
    const allow = allowed.split(',').map((s) => s.trim()).filter(Boolean).map(globToRegExp)
    rules.push({ source: source.trim(), regex, allow })
  })
  return { rules, skip }
}

/** Reads the pattern file; `null` if it does not exist. */
export function loadPatterns(file) {
  if (!existsSync(file)) return null
  return parsePatterns(readFileSync(file, 'utf8'))
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })

/** Root of the main checkout when `root` is a linked worktree; `null` otherwise. */
export function mainCheckoutRoot(root) {
  let common
  try { common = git(['rev-parse', '--git-common-dir'], root).trim() }
  catch { return null }
  common = path.resolve(root, common)
  // Bare repository or submodule: no main checkout next to the common .git folder.
  if (path.basename(common) !== '.git') return null
  const main = path.dirname(common)
  return path.resolve(main) === path.resolve(root) ? null : main
}

/**
 * Pattern file to use: the current checkout's, otherwise the main checkout's.
 * Returns `{ file, from: 'checkout' | 'main' }`, or `{ file: null, tried }` if none exists.
 */
export function findPatternsFile(root) {
  const own = path.join(root, PATTERNS_FILE)
  if (existsSync(own)) return { file: own, from: 'checkout' }
  const tried = [own]
  const main = mainCheckoutRoot(root)
  if (main) {
    const shared = path.join(main, PATTERNS_FILE)
    if (existsSync(shared)) return { file: shared, from: 'main' }
    tried.push(shared)
  }
  return { file: null, tried }
}

/** Shows enough to find the value without displaying it in full. */
export function redact(value) {
  if (value.length <= 4) return `${value[0] ?? ''}…`
  return `${value.slice(0, Math.min(4, Math.floor(value.length / 3)))}…(${value.length} chars)`
}

/** Looks for the patterns in a file's content. */
export function scanText(file, text, patterns) {
  if (ALWAYS_SKIPPED.includes(path.basename(file)) || matchesAny(file, patterns.skip)) return []
  const hits = []
  const lines = text.split('\n')
  for (const rule of patterns.rules) {
    if (matchesAny(file, rule.allow)) continue
    lines.forEach((line, i) => {
      for (const m of line.matchAll(rule.regex)) {
        if (!m[0]) continue
        hits.push({ file, line: i + 1, pattern: rule.source, excerpt: redact(m[0]) })
      }
    })
  }
  return hits
}

/** Copies the index content (all files or only staged ones) into a temporary folder. */
function exportIndex(root, staged) {
  const list = staged
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], root)
    : git(['ls-files', '-z'], root)
  const files = list.split('\0').filter(Boolean)
  const dir = mkdtempSync(path.join(tmpdir(), 'leaks-'))
  if (files.length) {
    execFileSync('git', ['checkout-index', '-z', '--stdin', `--prefix=${dir}/`], { cwd: root, input: files.join('\0') })
  }
  return { dir, files }
}

function runGitleaks(dir) {
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' })
  if (probe.error) {
    console.log('gitleaks: not installed, skipped (https://github.com/gitleaks/gitleaks). Forbidden patterns still run.')
    return true
  }
  const r = spawnSync('gitleaks', ['dir', dir, '--redact', '--no-banner', '--exit-code', '1'], { stdio: 'inherit' })
  if (r.status === 0) console.log('gitleaks: no secret found.')
  return r.status === 0
}

function main(argv) {
  const staged = argv.includes('--staged')
  const root = git(['rev-parse', '--show-toplevel']).trim()
  const { dir, files } = exportIndex(root, staged)
  try {
    if (!files.length) { console.log('check:leaks: nothing to scan.'); return 0 }
    let ok = runGitleaks(dir)

    const found = findPatternsFile(root)
    const patterns = found.file && loadPatterns(found.file)
    if (!patterns) {
      console.warn([
        `WARNING: no ${PATTERNS_FILE} file found, forbidden patterns were NOT checked.`,
        ...found.tried.map((f) => `  looked for: ${f}`),
        `  Copy ${PATTERNS_FILE}.example to ${PATTERNS_FILE} in the main checkout and fill it.`,
      ].join('\n'))
    }
    else {
      console.log(`patterns: using ${found.file}${found.from === 'main' ? ' (main checkout)' : ''}`)
      if (!patterns.rules.length) console.warn(`WARNING: ${found.file} has no active pattern, nothing is forbidden.`)
      const hits = []
      for (const file of files) {
        const buf = readFileSync(path.join(dir, file))
        if (buf.includes(0)) continue // binaire
        hits.push(...scanText(file, buf.toString('utf8'), patterns))
      }
      for (const h of hits) console.log(`${h.file}:${h.line}  ${h.excerpt}  [${h.pattern}]`)
      console.log(hits.length
        ? `patterns: ${hits.length} forbidden match(es) in ${files.length} file(s).`
        : `patterns: ${patterns.rules.length} pattern(s), ${files.length} file(s), no match.`)
      if (hits.length) ok = false
    }
    return ok ? 0 : 1
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))) }
  catch (e) { console.error(`check:leaks: ${e.message}`); process.exit(2) }
}
