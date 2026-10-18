// "SOURCE: unbound variable" in `herdr-plugin.sh update` (issue #45): in
// "$SOURCE…", macOS's bash 3.2 reads the first byte of "…" as a letter in a
// UTF-8 locale (as any bash does in a Latin-1 one), looks up "SOURCE\xe2",
// and `set -u` stops the script. A variable followed by a non-ASCII character
// must be written ${NAME}.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = path.resolve(import.meta.dirname, '..')
const UNBRACED = /\$[A-Za-z_]\w*[^\x00-\x7F]/

const SKIP = new Set(['node_modules', '.git', '.nuxt', '.output', '.data', '.shots', 'dist', 'test-results', 'playwright-report'])

function shellScripts(dir = REPO): string[] {
  const out: string[] = []
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(d.name) || d.name.startsWith('.herdr')) continue
    const full = path.join(dir, d.name)
    if (d.isDirectory()) out.push(...shellScripts(full))
    else if (d.isFile() && (d.name.endsWith('.sh') || isShellBin(full))) out.push(path.relative(REPO, full))
  }
  return out
}

function isShellBin(file: string) {
  if (path.extname(file)) return false
  try { return /^#!.*\b(ba|da|z)?sh\b/.test(readFileSync(file, 'utf8').slice(0, 80)) }
  catch { return false }
}

describe('shell scripts', () => {
  it('include herdr-plugin.sh', () => {
    expect(shellScripts()).toContain('scripts/herdr-plugin.sh')
  })

  it('brace every variable followed by a non-ASCII character', () => {
    const bad: string[] = []
    for (const f of shellScripts()) {
      readFileSync(path.join(REPO, f), 'utf8').split('\n').forEach((line, i) => {
        if (UNBRACED.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(bad).toEqual([])
  })

  // The failure itself, where bash and a Latin-1 locale exist.
  const norm = (l: string) => l.toLowerCase().replace(/[-_]/g, '')
  const r = spawnSync('bash', ['-c', 'locale -a'], { encoding: 'utf8' })
  const known = r.status === 0 ? r.stdout.split('\n').map(norm) : []
  const latin1 = ['en_US.iso885915', 'en_US.ISO8859-1', 'fr_FR.ISO8859-1'].find(l => known.includes(norm(l)))
  it.skipIf(!latin1)('fails unbraced and works braced under set -u', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wherdr-shvar-'))
    const run = (body: string) => {
      const f = path.join(dir, 's.sh')
      writeFileSync(f, `set -u\nSOURCE=owner/wherdr\necho "from ${body}…"\n`)
      return spawnSync('bash', [f], { encoding: 'utf8', env: { ...process.env, LC_ALL: latin1 } })
    }
    expect(run('$SOURCE').stderr).toMatch(/unbound variable/)
    const ok = run('${SOURCE}')
    expect(ok.status).toBe(0)
    expect(ok.stdout).toBe('from owner/wherdr…\n')
  })
})
