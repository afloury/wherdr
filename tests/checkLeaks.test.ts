// Contrôle anti-fuite : lecture des motifs, exceptions, masquage des valeurs trouvées.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error module JS sans déclarations
import { globToRegExp, loadPatterns, parsePatterns, redact, scanText } from '../scripts/check-leaks.mjs'

describe('check-leaks', () => {
  it('trouve un motif avec fichier, ligne et valeur tronquée', () => {
    const p = parsePatterns('# commentaire\n\nsecret-host\n')
    const hits = scanText('app/a.ts', 'ok\nconst h = "Secret-Host.lan"\n', p)
    expect(hits).toEqual([{ file: 'app/a.ts', line: 2, pattern: 'secret-host', excerpt: 'Sec…(11 chars)' }])
  })

  it('respecte les exceptions par motif et les fichiers ignorés', () => {
    const p = parsePatterns('alice !! LICENSE, docs/**\n! tests/fixtures/*.json\nbob\n')
    expect(scanText('LICENSE', 'Copyright alice', p)).toEqual([])
    expect(scanText('docs/a/b.md', 'alice', p)).toEqual([])
    expect(scanText('README.md', 'alice', p)).toHaveLength(1)
    expect(scanText('tests/fixtures/x.json', 'alice bob', p)).toEqual([])
    expect(scanText('.leak-patterns.example', 'bob', p)).toEqual([])
  })

  it('compte chaque occurrence sur une ligne', () => {
    expect(scanText('a', 'bob and BOB', parsePatterns('bob'))).toHaveLength(2)
  })

  it('renvoie null quand le fichier de motifs est absent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'leaks-test-'))
    expect(loadPatterns(path.join(dir, '.leak-patterns'))).toBeNull()
    writeFileSync(path.join(dir, '.leak-patterns'), 'x+\n')
    expect(loadPatterns(path.join(dir, '.leak-patterns')).rules).toHaveLength(1)
  })

  it('signale une regex invalide avec sa ligne', () => {
    expect(() => parsePatterns('ok\n(broken')).toThrow('.leak-patterns:2')
  })

  it('ne montre jamais la valeur entière', () => {
    expect(redact('abc')).toBe('a…')
    expect(redact('ghp_0123456789abcdef')).toBe('ghp_…(20 chars)')
    expect(globToRegExp('*.md').test('docs/a.md')).toBe(false)
  })
})
