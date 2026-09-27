import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Quotas } from '../shared/types'
import { claudeInstallCommand, claudeSetupOf, machineQuotaRows, quotaLeft, quotaRows, resetText } from '../app/utils/quotas'

// La commande d'installation passe settings.json à python3 (absent de node:22-alpine).
const hasPython = (() => { try { execFileSync('python3', ['-V'], { stdio: 'ignore' }); return true } catch { return false } })()
const five = (used: number) => ({ used, resetsAt: 2000, minutes: 300 })

describe('répartition des quotas (haut / machines)', () => {
  it('un seul compte : Claude et Codex en haut, rien sous les machines', () => {
    const q: Quotas = { claude: { five: five(10), week: null, at: 1 }, codex: { five: five(40), week: null, at: 2 } }
    expect(quotaRows(q).map(r => r.key)).toEqual(['claude', 'codex'])
    expect(machineQuotaRows(q, '')).toEqual([])
    expect(quotaRows(null)).toEqual([])
    expect(quotaRows(q, ['claude']).map(r => r.key)).toEqual(['codex'])
    expect(quotaRows(q, ['codex']).map(r => r.key)).toEqual(['claude'])
    expect(quotaRows(q, ['claude', 'codex'])).toEqual([])
  })

  it('comptes différents : Codex (partagé) en haut, le compte Claude de chaque machine sous elle', () => {
    const q: Quotas = {
      claude: { five: five(30), week: null, at: 3 },
      codex: { five: five(40), week: null, at: 2 },
      claudeAccounts: [
        { five: five(10), week: null, at: 1, machines: [{ key: '', label: 'host-a' }, { key: '0c1d2e3f', label: 'Workstation' }] },
        { five: five(30), week: null, at: 3, machines: [{ key: 'f27df2ea', label: 'Laptop' }] },
      ],
    }
    expect(quotaRows(q).map(r => r.key)).toEqual(['codex'])
    const mac = machineQuotaRows(q, 'f27df2ea')
    expect(mac.map(r => [r.agent, r.q.five!.used])).toEqual([['claude', 30]])
    expect(mac[0]!.q).not.toHaveProperty('machines')
    // Même compte sur deux machines sur trois : sous chacune des deux.
    expect(machineQuotaRows(q, '')[0]!.q.five!.used).toBe(10)
    expect(machineQuotaRows(q, '0c1d2e3f')[0]!.q.five!.used).toBe(10)
    expect(machineQuotaRows(q, 'deadbeef')).toEqual([])
    expect(quotaRows(q, ['codex'])).toEqual([])
    expect(machineQuotaRows(q, 'f27df2ea', ['claude'])).toEqual([])
    expect(machineQuotaRows(q, '', ['codex']).map(r => r.agent)).toEqual(['claude'])
  })

  it('part restante : fenêtre réinitialisée depuis la lecture = 100 %', () => {
    expect(quotaLeft(five(62.4), 1000)).toBe(38)
    expect(quotaLeft(five(62.4), 3000)).toBe(100)
  })
})

describe('heure de réinitialisation', () => {
  const now = new Date(2026, 8, 26, 20, 0).getTime() // samedi 20:00 (heure locale)
  const w = (at: Date | null) => ({ used: 10, resetsAt: at ? at.getTime() : null, minutes: 300 })
  it('dans les 24 h : l’heure seule, même le lendemain', () => {
    expect(resetText(w(new Date(2026, 8, 27, 0, 0)), now, 'fr')).toBe('00:00')
    expect(resetText(w(new Date(2026, 8, 26, 23, 20)), now, 'fr')).toBe('23:20')
  })
  it('au-delà : le jour en plus ; passée : null ; inconnue : vide', () => {
    expect(resetText(w(new Date(2026, 8, 28, 19, 0)), now, 'fr')).toMatch(/^lun\.? 19:00$/)
    expect(resetText(w(new Date(2026, 8, 26, 19, 0)), now, 'fr')).toBeNull()
    expect(resetText(w(null), now, 'fr')).toBe('')
  })
})

describe('quotas Claude non configurés', () => {
  const q: Quotas = { claude: null, codex: null, claudeSetup: [{ key: 'f27df2ea', state: 'missing', installable: true }] }
  it('seulement sur une machine listée qui a des agents Claude', () => {
    expect(claudeSetupOf(q, 'f27df2ea', true)).toEqual({ key: 'f27df2ea', state: 'missing', installable: true })
    expect(claudeSetupOf(q, 'f27df2ea', false)).toBeNull()
    expect(claudeSetupOf(q, '', true)).toBeNull()
    expect(claudeSetupOf(null, '', true)).toBeNull()
    expect(claudeSetupOf(q, 'f27df2ea', true, ['claude'])).toBeNull()
    expect(claudeSetupOf(q, 'f27df2ea', true, ['codex'])).not.toBeNull()
  })

  it.skipIf(!hasPython)('la commande à copier est autonome : barre d’état écrite et branchée', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-'))
    try {
      const env = { PATH: process.env.PATH, HOME: home }
      execFileSync('sh', ['-c', claudeInstallCommand], { env, stdio: 'pipe' })
      const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'))
      expect(settings.statusLine.command).toContain('wherdr-statusline.sh')
      // Elle garde les quotas et laisse passer une barre d'état enchaînée.
      const out = execFileSync('sh', [path.join(home, '.claude/wherdr-statusline.sh'), 'cat'], { env, input: '{"rate_limits":{}}' }).toString()
      expect(out).toBe('{"rate_limits":{}}')
      expect(fs.readFileSync(path.join(home, '.cache/herdr-web/claude-status.json'), 'utf8')).toBe('{"rate_limits":{}}')
      // Relancée : rien ne change dans settings.json.
      execFileSync('sh', ['-c', claudeInstallCommand], { env, stdio: 'pipe' })
      expect(JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'))).toEqual(settings)
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  })
})
