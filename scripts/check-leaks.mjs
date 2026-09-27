#!/usr/bin/env node
// Contrôle anti-fuite : gitleaks (s'il est installé) + motifs interdits lus dans un fichier local
// non suivi (.leak-patterns). Scanne le contenu de l'index git (fichiers suivis ou indexés) ;
// `--staged` ne scanne que les fichiers indexés (hook pre-commit).
//
// Format de .leak-patterns (voir .leak-patterns.example) :
//   # commentaire
//   <regex>                        motif interdit (insensible à la casse)
//   <regex>  !! LICENSE, docs/*.md motif toléré dans ces fichiers
//   ! <glob>                       fichier jamais scanné par les motifs
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PATTERNS_FILE = '.leak-patterns'
const ALWAYS_SKIPPED = ['.leak-patterns', '.leak-patterns.example', 'package-lock.json']

/** Glob simple : `*` = tout sauf `/`, `**` = tout, `?` = un caractère. */
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

/** Analyse le texte du fichier de motifs. Lève une erreur lisible sur une regex invalide. */
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

/** Lit le fichier de motifs ; `null` s'il n'existe pas. */
export function loadPatterns(file) {
  if (!existsSync(file)) return null
  return parsePatterns(readFileSync(file, 'utf8'))
}

/** Montre assez pour retrouver la valeur sans l'afficher en entier. */
export function redact(value) {
  if (value.length <= 4) return `${value[0] ?? ''}…`
  return `${value.slice(0, Math.min(4, Math.floor(value.length / 3)))}…(${value.length} chars)`
}

/** Cherche les motifs dans le contenu d'un fichier. */
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

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })

/** Copie le contenu de l'index (tous les fichiers ou seulement les indexés) dans un dossier temporaire. */
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

    const patterns = loadPatterns(path.join(root, PATTERNS_FILE))
    if (!patterns) {
      console.log(`patterns: no ${PATTERNS_FILE} file, skipped (copy ${PATTERNS_FILE}.example and fill it).`)
    }
    else {
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
