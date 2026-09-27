import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Quota } from '../shared/types'
import { localFs } from '../server/utils/fsx'
import { claudeQuota, claudeSetupState, codexAccount, codexQuota, machineCodexQuota, lastCodexLimits, latestCodexQuota, mergeQuotas, readCodex, sameAccount } from '../server/utils/quotas'

describe('quotas', () => {
  it('lit les quotas de la barre d’état de Claude Code', () => {
    const q = claudeQuota({ rate_limits: { five_hour: { used_percentage: 8, resets_at: 1790395200 }, seven_day: { used_percentage: 69, resets_at: 1790600400 } } }, 1790390000000)
    expect(q).toEqual({
      five: { used: 8, resetsAt: 1790395200000, minutes: 300 },
      week: { used: 69, resetsAt: 1790600400000, minutes: 10080 },
      at: 1790390000000,
    })
    expect(claudeQuota({ cwd: '/x' }, 5)).toBeNull()
  })

  it('fenêtre de 5 h absente (elle vient de repartir) : 100 % restants, nouvelle fenêtre', () => {
    const q = claudeQuota({ rate_limits: { seven_day: { used_percentage: 69, resets_at: 1790600400 } } }, 1790390000000)!
    expect(q.five).toEqual({ used: 0, resetsAt: null, minutes: 300, fresh: true })
    expect(q.week!.used).toBe(69)
    expect(claudeQuota({ rate_limits: {} }, 5)).toBeNull()
  })

  it('semaine absente (elle vient de repartir) : 100 % restants, nouvelle fenêtre', () => {
    const q = claudeQuota({ rate_limits: { five_hour: { used_percentage: 12, resets_at: 1790400000 } } }, 1790390000000)!
    expect(q.week).toEqual({ used: 0, resetsAt: null, minutes: 10080, fresh: true })
    expect(q.five).toEqual({ used: 12, resetsAt: 1790400000000, minutes: 300 })
  })

  it('Codex : une fenêtre absente du forfait n’est pas inventée', () => {
    const q = codexQuota({ primary: { used_percent: 30, window_minutes: 10080, resets_at: 1790851728 }, secondary: null }, 1790390000000)!
    expect(q.five).toBeNull()
    expect(q.week!.used).toBe(30)
  })

  it('lit la dernière limite d’une conversation Codex', () => {
    const line = (t: string, p: number) => JSON.stringify({ timestamp: t, type: 'event_msg', payload: { type: 'token_count', rate_limits: {
      limit_id: 'codex', primary: { used_percent: p, window_minutes: 300, resets_at: 1790399286 }, secondary: { used_percent: 18, window_minutes: 10080, resets_at: 1790851728 },
    } } })
    const hit = lastCodexLimits([line('2026-09-26T02:00:00Z', 40), line('2026-09-26T02:58:49.742Z', 58), '{"coupé'].join('\n'))!
    expect(hit.at).toBe(Date.parse('2026-09-26T02:58:49.742Z'))
    expect(codexQuota(hit.rl, hit.at)).toEqual({
      five: { used: 58, resetsAt: 1790399286000, minutes: 300 },
      week: { used: 18, resetsAt: 1790851728000, minutes: 10080 },
      at: hit.at,
    })
    expect(lastCodexLimits('{"type":"x"}')).toBeNull()
  })
})

describe('quota Codex sur plusieurs conversations', () => {
  const RESET = Date.parse('2026-09-27T15:30:00Z') / 1000
  const WEEK_RESET = Date.parse('2026-10-01T09:00:00Z') / 1000
  const line = (t: string | null, p: number, w = 30, reset = RESET) => JSON.stringify({ ...(t ? { timestamp: t } : {}), type: 'event_msg', payload: { type: 'token_count', rate_limits: {
    primary: { used_percent: p, window_minutes: 300, resets_at: reset }, secondary: { used_percent: w, window_minutes: 10080, resets_at: WEEK_RESET },
  } } })
  const reading = (t: string | null, p: number, w = 30, reset = RESET) => {
    const hit = lastCodexLimits(line(t, p, w, reset))!
    return { q: codexQuota(hit.rl, hit.at || Date.parse('2026-09-27T13:31:00Z'))!, stamp: hit.at }
  }

  it('garde la lecture la plus récente, pas celle du dernier fichier modifié', () => {
    const q = latestCodexQuota([
      reading('2026-09-27T11:40:00Z', 49, 20), // vieille session, modifiée en dernier
      reading('2026-09-27T13:25:00Z', 99, 31),
      reading('2026-09-27T13:26:00Z', 100, 32),
    ])!
    expect(q.five).toEqual({ used: 100, resetsAt: RESET * 1000, minutes: 300 })
    expect(q.week!.used).toBe(32)
  })

  it('même fenêtre : l’usage le plus élevé, même lu plus tôt ou sans horodatage', () => {
    // Heure de réinitialisation recalculée à chaque réponse : quelques secondes d'écart.
    expect(latestCodexQuota([reading('2026-09-27T13:31:00Z', 49), reading('2026-09-27T13:26:00Z', 100, 30, RESET - 4)])!.five!.used).toBe(100)
    expect(latestCodexQuota([reading(null, 49), reading(null, 100)])!.five!.used).toBe(100)
    expect(latestCodexQuota([])).toBeNull()
  })

  it('fenêtre réinitialisée depuis : la lecture récente l’emporte sur la valeur haute d’avant', () => {
    const next = RESET + 5 * 3600
    const q = latestCodexQuota([reading('2026-09-27T13:26:00Z', 100), reading('2026-09-27T15:45:00Z', 3, 30, next)])!
    expect(q.five).toEqual({ used: 3, resetsAt: next * 1000, minutes: 300 })
  })

  it('lit les conversations récentes du disque (vieux fichier modifié en dernier)', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-codex-'))
    const now = new Date()
    const dir = path.join(home, '.codex/sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'))
    fs.mkdirSync(dir, { recursive: true })
    const t = (min: number) => new Date(now.getTime() - min * 60000)
    const write = (name: string, lines: string[], mtime: Date) => {
      const f = path.join(dir, `rollout-${name}.jsonl`)
      fs.writeFileSync(f, lines.join('\n') + '\n' + '{"type":"response_item"}\n'.repeat(50))
      fs.utimesSync(f, mtime, mtime)
    }
    const reset = Math.round(now.getTime() / 1000) + 7200
    write('old', [line(t(140).toISOString(), 40, 20, reset), line(t(120).toISOString(), 49, 20, reset)], t(4))
    write('a', [line(t(12).toISOString(), 99, 31, reset)], t(10))
    write('b', [line(t(10).toISOString(), 99, 31, reset), line(t(9).toISOString(), 100, 32, reset)], t(9))
    try {
      const q = (await readCodex(localFs, home))!
      expect(q.five!.used).toBe(100)
      expect(q.week!.used).toBe(32)
      expect(q.at).toBe(t(9).getTime()) // horodatage de la lecture, pas date du fichier
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  })
})

describe('quotas par compte', () => {
  const H = 3600000
  const WEEK = 7 * 24 * H
  const q = (at: number, account: string | null, weekReset = 1790600400000, used = 10) =>
    ({ five: { used, resetsAt: 1790395200000, minutes: 300 }, week: { used, resetsAt: weekReset, minutes: 10080 }, at, account })
  const r = (key: string, label: string, claude: ReturnType<typeof q> | null, codex: Quota | null = null) => ({ key, label, claude, codex })

  it('fusionne les machines d’un même compte (même empreinte)', () => {
    const out = mergeQuotas([r('', 'Server', q(1, 'aaaaaaaaaaaaaaaa', 1790600400000, 20)), r('f27df2ea', 'Laptop', q(2, 'aaaaaaaaaaaaaaaa', 1790600400000, 30))])
    expect(out.claudeAccounts).toBeUndefined()
    expect(out.claude).toEqual({ five: { used: 30, resetsAt: 1790395200000, minutes: 300 }, week: { used: 30, resetsAt: 1790600400000, minutes: 10080 }, at: 2 })
  })

  it('sépare les comptes et étiquette chaque bloc par ses machines', () => {
    const out = mergeQuotas([
      r('', 'Server', q(5, 'aaaaaaaaaaaaaaaa')),
      r('f27df2ea', 'Laptop', q(3, 'bbbbbbbbbbbbbbbb')),
      r('0c1d2e3f', 'Workstation', q(9, 'aaaaaaaaaaaaaaaa')),
    ])
    expect(out.claudeAccounts!.map(a => [a.machines.map(m => m.label), a.at])).toEqual([[['Server', 'Workstation'], 9], [['Laptop'], 3]])
    expect(out.claude!.at).toBe(9)
    expect(out.claudeAccounts![0]).not.toHaveProperty('account')
  })

  it('sans empreinte, compare l’heure de réinitialisation hebdomadaire', () => {
    // Même compte : même ancrage, même lu une semaine plus tôt.
    expect(sameAccount(q(1, null), q(2, null, 1790600400000 + WEEK))).toBe(true)
    expect(sameAccount(q(1, 'aaaaaaaaaaaaaaaa'), q(2, null, 1790600400000 + 60000))).toBe(true)
    // Autre compte : autre ancrage.
    expect(sameAccount(q(1, null), q(2, 'bbbbbbbbbbbbbbbb', 1790600400000 + 14 * H))).toBe(false)
    // Empreintes connues : elles priment.
    expect(sameAccount(q(1, 'aaaaaaaaaaaaaaaa'), q(2, 'bbbbbbbbbbbbbbbb'))).toBe(false)
    expect(sameAccount(q(1, 'aaaaaaaaaaaaaaaa'), q(2, 'aaaaaaaaaaaaaaaa', 1790600400000 + 3 * H))).toBe(true)
    // Rien de comparable : même compte (affichage d'avant).
    expect(sameAccount({ ...q(1, null), week: null }, q(2, null, 1790600400000 + 3 * H))).toBe(true)
  })

  it('une machine sans lecture (hors ligne, non lue) ne crée pas de bloc', () => {
    const out = mergeQuotas([r('', 'Server', q(5, 'aaaaaaaaaaaaaaaa')), r('f27df2ea', 'Laptop', null)])
    expect(out.claudeAccounts).toBeUndefined()
    expect(out.claude!.at).toBe(5)
    expect(mergeQuotas([])).toEqual({ claude: null, codex: null })
  })

  it('Codex : lecture la plus récente, toutes machines', () => {
    const cx = (at: number) => ({ five: null, week: null, at })
    expect(mergeQuotas([r('', 'Server', null, cx(1)), r('f27df2ea', 'Laptop', null, cx(4))]).codex!.at).toBe(4)
  })
})

describe('heure de réinitialisation impossible', () => {
  it('une fenêtre de 5 h qui se réinitialiserait dans 2 jours : heure inconnue', () => {
    const at = 1790395200000 - 3600000
    const q = claudeQuota({ rate_limits: { five_hour: { used_percentage: 8, resets_at: 1790395200 + 2 * 86400 }, seven_day: { used_percentage: 69, resets_at: 1790600400 } } }, at)!
    expect(q.five).toEqual({ used: 8, resetsAt: null, minutes: 300 })
    expect(q.week!.resetsAt).toBe(1790600400000)
    // Plausible : gardée.
    expect(claudeQuota({ rate_limits: { five_hour: { used_percentage: 8, resets_at: 1790395200 } } }, at)!.five!.resetsAt).toBe(1790395200000)
  })
})

describe('barre d’état Claude en place ?', () => {
  const status = { rate_limits: { five_hour: { used_percentage: 1, resets_at: 1 } } }
  const ours = '#!/bin/sh\n# … claude-account …'
  const wired = '{ "statusLine": { "command": "sh /home/x/.claude/wherdr-statusline.sh" } }'
  it('lecture complète, ou compte sans quotas : ok', () => {
    expect(claudeSetupState({ status, account: true, statusline: null, settings: null })).toBe('ok')
    expect(claudeSetupState({ status: { cwd: '/' }, account: false, statusline: null, settings: null })).toBe('ok')
  })
  it('rien, ou ancienne barre d’état sans empreinte : missing', () => {
    expect(claudeSetupState({ status: null, account: false, statusline: null, settings: null })).toBe('missing')
    expect(claudeSetupState({ status, account: false, statusline: '#!/bin/sh\n# ancienne', settings: wired })).toBe('missing')
    // Barre d'état écrite mais pas branchée dans settings.json.
    expect(claudeSetupState({ status: null, account: false, statusline: ours, settings: '{}' })).toBe('missing')
  })
  it('installée, en attente du prochain échange : pending', () => {
    expect(claudeSetupState({ status: null, account: false, statusline: ours, settings: wired })).toBe('pending')
    // À jour mais empreinte illisible : rien de plus à installer.
    expect(claudeSetupState({ status, account: false, statusline: ours, settings: wired })).toBe('ok')
  })
  it('mergeQuotas liste les machines à configurer', () => {
    const out = mergeQuotas([
      { key: '', label: 'Server', claude: null, codex: null, setup: null },
      { key: 'f27df2ea', label: 'Laptop', claude: null, codex: null, setup: { key: 'f27df2ea', state: 'missing', installable: true } },
    ])
    expect(out.claudeSetup).toEqual([{ key: 'f27df2ea', state: 'missing', installable: true }])
    expect(mergeQuotas([{ key: '', label: 'Server', claude: null, codex: null }])).toEqual({ claude: null, codex: null })
  })
})

describe('quotas Codex par compte', () => {
  const cx = (at: number, account?: string | null, used = 10) => ({ five: { used, resetsAt: 1790395200000, minutes: 300 }, week: null, at, account })
  const r = (key: string, label: string, codex: ReturnType<typeof cx> | null) => ({ key, label, claude: null, codex })

  it('empreinte tirée de session_meta, jamais la valeur brute', () => {
    const head = `${JSON.stringify({ type: 'session_meta', payload: { id: 'x', creator_account_id: 'acct-test-1' } })}\n{"type":"x"}`
    const fp = codexAccount(head)!
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
    expect(fp).not.toContain('acct')
    expect(codexAccount(head.replace('acct-test-1', 'acct-test-2'))).not.toBe(fp)
    expect(codexAccount('{"type":"session_meta","payload":{}}')).toBeNull()
    expect(codexAccount('{"type":"event_msg","payload":{"creator_account_id":"a"}}')).toBeNull()
  })

  it('même compte : un seul bloc', () => {
    const out = mergeQuotas([r('', 'Server', cx(1, 'aaaaaaaaaaaaaaaa')), r('f27df2ea', 'Laptop', cx(2, 'aaaaaaaaaaaaaaaa', 30))])
    expect(out.codexAccounts).toBeUndefined()
    expect(out.codex).toEqual({ five: { used: 30, resetsAt: 1790395200000, minutes: 300 }, week: null, at: 2 })
  })

  it('comptes différents : un bloc par machine', () => {
    const out = mergeQuotas([r('', 'Server', cx(5, 'aaaaaaaaaaaaaaaa')), r('f27df2ea', 'Laptop', cx(3, 'bbbbbbbbbbbbbbbb'))])
    expect(out.codexAccounts!.map(a => [a.machines.map(m => m.label), a.at])).toEqual([[['Server'], 5], [['Laptop'], 3]])
    expect(out.codexAccounts![0]).not.toHaveProperty('account')
    expect(out.codex).not.toHaveProperty('account')
  })

  it('sans empreinte : comportement d’avant (la plus récente)', () => {
    const out = mergeQuotas([r('', 'Server', cx(1, null)), r('f27df2ea', 'Laptop', cx(4))])
    expect(out.codexAccounts).toBeUndefined()
    expect(out.codex!.at).toBe(4)
  })

  it('une machine : le compte de la conversation la plus récente', () => {
    const rd = (stamp: number, account: string | null, used: number) => ({ q: { five: { used, resetsAt: 1790395200000, minutes: 300 }, week: null, at: stamp }, stamp, account })
    const q = machineCodexQuota([rd(1, 'aaaaaaaaaaaaaaaa', 90), rd(2, 'bbbbbbbbbbbbbbbb', 5), rd(0, null, 7)])!
    expect(q.account).toBe('bbbbbbbbbbbbbbbb')
    expect(q.five!.used).toBe(7)
    expect(machineCodexQuota([])).toBeNull()
  })
})
