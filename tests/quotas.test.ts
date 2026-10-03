import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Quota } from '../shared/types'
import { type CodexScreenWeekly, weekFromScreen } from '../shared/codexStatus'
import { localFs } from '../server/utils/fsx'
import { applyCodexKnown, claudeQuota, claudeSetupState, codexAccount, codexQuota, machineCodexQuota, lastCodexLimits, latestCodexQuota, mergeQuotas, readCodex, sameAccount } from '../server/utils/quotas'

describe('quotas', () => {
  it('reads the quotas from Claude Code\'s status line', () => {
    const q = claudeQuota({ rate_limits: { five_hour: { used_percentage: 8, resets_at: 1790395200 }, seven_day: { used_percentage: 69, resets_at: 1790600400 } } }, 1790390000000)
    expect(q).toEqual({
      five: { used: 8, resetsAt: 1790395200000, minutes: 300 },
      week: { used: 69, resetsAt: 1790600400000, minutes: 10080 },
      at: 1790390000000,
    })
    expect(claudeQuota({ cwd: '/x' }, 5)).toBeNull()
  })

  it('5-hour window missing (it just restarted): 100 % remaining, new window', () => {
    const q = claudeQuota({ rate_limits: { seven_day: { used_percentage: 69, resets_at: 1790600400 } } }, 1790390000000)!
    expect(q.five).toEqual({ used: 0, resetsAt: null, minutes: 300, fresh: true })
    expect(q.week!.used).toBe(69)
    expect(claudeQuota({ rate_limits: {} }, 5)).toBeNull()
  })

  it('week missing (it just restarted): 100 % remaining, new window', () => {
    const q = claudeQuota({ rate_limits: { five_hour: { used_percentage: 12, resets_at: 1790400000 } } }, 1790390000000)!
    expect(q.week).toEqual({ used: 0, resetsAt: null, minutes: 10080, fresh: true })
    expect(q.five).toEqual({ used: 12, resetsAt: 1790400000000, minutes: 300 })
  })

  it('Codex: a window absent from the plan is not invented', () => {
    const q = codexQuota({ primary: { used_percent: 30, window_minutes: 10080, resets_at: 1790851728 }, secondary: null }, 1790390000000)!
    expect(q.five).toBeNull()
    expect(q.week!.used).toBe(30)
  })

  it('reads the last limit of a Codex conversation', () => {
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

  it('keeps the most recent reading, not that of the last modified file', () => {
    const q = latestCodexQuota([
      reading('2026-09-27T11:40:00Z', 49, 20), // old session, modified last
      reading('2026-09-27T13:25:00Z', 99, 31),
      reading('2026-09-27T13:26:00Z', 100, 32),
    ])!
    expect(q.five).toEqual({ used: 100, resetsAt: RESET * 1000, minutes: 300 })
    expect(q.week!.used).toBe(32)
  })

  it('same window: the highest usage, even if read earlier or without a timestamp', () => {
    // Reset time recomputed on each reply: a few seconds apart.
    expect(latestCodexQuota([reading('2026-09-27T13:31:00Z', 49), reading('2026-09-27T13:26:00Z', 100, 30, RESET - 4)])!.five!.used).toBe(100)
    expect(latestCodexQuota([reading(null, 49), reading(null, 100)])!.five!.used).toBe(100)
    expect(latestCodexQuota([])).toBeNull()
  })

  it('window reset since: the recent reading wins over the old high value', () => {
    const next = RESET + 5 * 3600
    const q = latestCodexQuota([reading('2026-09-27T13:26:00Z', 100), reading('2026-09-27T15:45:00Z', 3, 30, next)])!
    expect(q.five).toEqual({ used: 3, resetsAt: next * 1000, minutes: 300 })
  })

  it('reads the recent conversations from disk (old file modified last)', async () => {
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
      expect(q.at).toBe(t(9).getTime()) // timestamp of the reading, not the file date
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  })
})

describe('quotas par compte', () => {
  const H = 3600000
  const WEEK = 7 * 24 * H
  const q = (at: number, account: string | null, weekReset = 1790600400000, used = 10) =>
    ({ five: { used, resetsAt: 1790395200000, minutes: 300 }, week: { used, resetsAt: weekReset, minutes: 10080 }, at, account })
  const r = (key: string, label: string, claude: ReturnType<typeof q> | null, codex: Quota | null = null) => ({ key, label, claude, codex })

  it('merges the machines of the same account (same fingerprint)', () => {
    const out = mergeQuotas([r('', 'Server', q(1, 'aaaaaaaaaaaaaaaa', 1790600400000, 20)), r('f27df2ea', 'Laptop', q(2, 'aaaaaaaaaaaaaaaa', 1790600400000, 30))])
    expect(out.claudeAccounts).toBeUndefined()
    expect(out.claude).toEqual({ five: { used: 30, resetsAt: 1790395200000, minutes: 300 }, week: { used: 30, resetsAt: 1790600400000, minutes: 10080 }, at: 2 })
  })

  it('separates accounts and labels each block with its machines', () => {
    const out = mergeQuotas([
      r('', 'Server', q(5, 'aaaaaaaaaaaaaaaa')),
      r('f27df2ea', 'Laptop', q(3, 'bbbbbbbbbbbbbbbb')),
      r('0c1d2e3f', 'Workstation', q(9, 'aaaaaaaaaaaaaaaa')),
    ])
    expect(out.claudeAccounts!.map(a => [a.machines.map(m => m.label), a.at])).toEqual([[['Server', 'Workstation'], 9], [['Laptop'], 3]])
    expect(out.claude!.at).toBe(9)
    expect(out.claudeAccounts![0]).not.toHaveProperty('account')
  })

  it('without a fingerprint, compares the weekly reset time', () => {
    // Same account: same anchor, even read a week earlier.
    expect(sameAccount(q(1, null), q(2, null, 1790600400000 + WEEK))).toBe(true)
    expect(sameAccount(q(1, 'aaaaaaaaaaaaaaaa'), q(2, null, 1790600400000 + 60000))).toBe(true)
    // Autre compte : autre ancrage.
    expect(sameAccount(q(1, null), q(2, 'bbbbbbbbbbbbbbbb', 1790600400000 + 14 * H))).toBe(false)
    // Empreintes connues : elles priment.
    expect(sameAccount(q(1, 'aaaaaaaaaaaaaaaa'), q(2, 'bbbbbbbbbbbbbbbb'))).toBe(false)
    expect(sameAccount(q(1, 'aaaaaaaaaaaaaaaa'), q(2, 'aaaaaaaaaaaaaaaa', 1790600400000 + 3 * H))).toBe(true)
    // Nothing comparable: same account (previous display).
    expect(sameAccount({ ...q(1, null), week: null }, q(2, null, 1790600400000 + 3 * H))).toBe(true)
  })

  it('a machine without a reading (offline, unread) creates no block', () => {
    const out = mergeQuotas([r('', 'Server', q(5, 'aaaaaaaaaaaaaaaa')), r('f27df2ea', 'Laptop', null)])
    expect(out.claudeAccounts).toBeUndefined()
    expect(out.claude!.at).toBe(5)
    expect(mergeQuotas([])).toEqual({ claude: null, codex: null })
  })

  it('Codex: most recent reading, all machines', () => {
    const cx = (at: number) => ({ five: null, week: null, at })
    expect(mergeQuotas([r('', 'Server', null, cx(1)), r('f27df2ea', 'Laptop', null, cx(4))]).codex!.at).toBe(4)
  })
})

describe('impossible reset time', () => {
  it('a 5-hour window that would reset in 2 days: unknown time', () => {
    const at = 1790395200000 - 3600000
    const q = claudeQuota({ rate_limits: { five_hour: { used_percentage: 8, resets_at: 1790395200 + 2 * 86400 }, seven_day: { used_percentage: 69, resets_at: 1790600400 } } }, at)!
    expect(q.five).toEqual({ used: 8, resetsAt: null, minutes: 300 })
    expect(q.week!.resetsAt).toBe(1790600400000)
    // Plausible: kept.
    expect(claudeQuota({ rate_limits: { five_hour: { used_percentage: 8, resets_at: 1790395200 } } }, at)!.five!.resetsAt).toBe(1790395200000)
  })
})

describe('Claude status line set up?', () => {
  const status = { rate_limits: { five_hour: { used_percentage: 1, resets_at: 1 } } }
  const ours = '#!/bin/sh\n# … claude-account …'
  const wired = '{ "statusLine": { "command": "sh /home/x/.claude/wherdr-statusline.sh" } }'
  it('complete reading, or account without quotas: ok', () => {
    expect(claudeSetupState({ status, account: true, statusline: null, settings: null })).toBe('ok')
    expect(claudeSetupState({ status: { cwd: '/' }, account: false, statusline: null, settings: null })).toBe('ok')
  })
  it('nothing, or old status line without a fingerprint: missing', () => {
    expect(claudeSetupState({ status: null, account: false, statusline: null, settings: null })).toBe('missing')
    expect(claudeSetupState({ status, account: false, statusline: '#!/bin/sh\n# ancienne', settings: wired })).toBe('missing')
    // Status line written but not wired into settings.json.
    expect(claudeSetupState({ status: null, account: false, statusline: ours, settings: '{}' })).toBe('missing')
  })
  it('installed, waiting for the next exchange: pending', () => {
    expect(claudeSetupState({ status: null, account: false, statusline: ours, settings: wired })).toBe('pending')
    // Up to date but unreadable fingerprint: nothing more to install.
    expect(claudeSetupState({ status, account: false, statusline: ours, settings: wired })).toBe('ok')
  })
  it('mergeQuotas lists the machines to configure', () => {
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

  it('fingerprint taken from session_meta, never the raw value', () => {
    const head = `${JSON.stringify({ type: 'session_meta', payload: { id: 'x', creator_account_id: 'acct-test-1' } })}\n{"type":"x"}`
    const fp = codexAccount(head)!
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
    expect(fp).not.toContain('acct')
    expect(codexAccount(head.replace('acct-test-1', 'acct-test-2'))).not.toBe(fp)
    expect(codexAccount('{"type":"session_meta","payload":{}}')).toBeNull()
    expect(codexAccount('{"type":"event_msg","payload":{"creator_account_id":"a"}}')).toBeNull()
  })

  it('same account: a single block', () => {
    const out = mergeQuotas([r('', 'Server', cx(1, 'aaaaaaaaaaaaaaaa')), r('f27df2ea', 'Laptop', cx(2, 'aaaaaaaaaaaaaaaa', 30))])
    expect(out.codexAccounts).toBeUndefined()
    expect(out.codex).toEqual({ five: { used: 30, resetsAt: 1790395200000, minutes: 300 }, week: null, at: 2 })
  })

  it('different accounts: one block per machine', () => {
    const out = mergeQuotas([r('', 'Server', cx(5, 'aaaaaaaaaaaaaaaa')), r('f27df2ea', 'Laptop', cx(3, 'bbbbbbbbbbbbbbbb'))])
    expect(out.codexAccounts!.map(a => [a.machines.map(m => m.label), a.at])).toEqual([[['Server'], 5], [['Laptop'], 3]])
    expect(out.codexAccounts![0]).not.toHaveProperty('account')
    expect(out.codex).not.toHaveProperty('account')
  })

  it('without a fingerprint: previous behaviour (the most recent)', () => {
    const out = mergeQuotas([r('', 'Server', cx(1, null)), r('f27df2ea', 'Laptop', cx(4))])
    expect(out.codexAccounts).toBeUndefined()
    expect(out.codex!.at).toBe(4)
  })

  it('one machine: the account of the most recent conversation', () => {
    const rd = (stamp: number, account: string | null, used: number) => ({ q: { five: { used, resetsAt: 1790395200000, minutes: 300 }, week: null, at: stamp }, stamp, account })
    const q = machineCodexQuota([rd(1, 'aaaaaaaaaaaaaaaa', 90), rd(2, 'bbbbbbbbbbbbbbbb', 5), rd(0, null, 7)])!
    expect(q.account).toBe('bbbbbbbbbbbbbbbb')
    expect(q.five!.used).toBe(7)
    expect(machineCodexQuota([])).toBeNull()
  })
})

describe('Codex week checked against /status', () => {
  const now = new Date(2026, 9, 3, 10, 37).getTime()
  // A `/status` gauge on screen, as remembered for the machine.
  const applyCodexScreen = (q: Quota, w: CodexScreenWeekly | null) => applyCodexKnown(q, weekFromScreen(w, now), now)
  const H = 3600000
  // Last conversation: 10 h old, 88 % of the week used, reset in 17 h.
  const stale: Quota = { five: { used: 30, resetsAt: now - 5 * H, minutes: 300 }, week: { used: 88, resetsAt: now + 17 * H, minutes: 10080 }, at: now - 10 * H }
  it('regression: stale rollout + /status at 100 % after an early reset: the screen wins', () => {
    const q = applyCodexScreen(stale, { left: 100, exact: true, resets: '10:33 on 10 Oct' })
    expect(q.week).toEqual({ used: 0, resetsAt: new Date(2026, 9, 10, 10, 33).getTime(), minutes: 10080 })
    expect(q.five).toBe(stale.five)
    expect(q.at).toBe(stale.at) // age of the conversations kept
  })
  it('same window: the higher usage wins', () => {
    const at = new Date(now + 17 * H)
    const resets = `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')} on ${at.getDate()} Oct`
    expect(applyCodexScreen(stale, { left: 5, exact: true, resets }).week).toMatchObject({ used: 95, resetsAt: stale.week!.resetsAt })
    expect(applyCodexScreen(stale, { left: 40, exact: true, resets })).toBe(stale)
  })
  it('expired window: left as is (shown renewed), unless /status gives the new one', () => {
    const expired = { ...stale, week: { ...stale.week!, resetsAt: now - H } }
    expect(applyCodexScreen(expired, null)).toBe(expired)
    expect(applyCodexScreen(expired, { left: 12, exact: true })).toBe(expired)
    expect(applyCodexScreen(expired, { left: 97, exact: true, resets: '10:33 on 10 Oct' }).week).toMatchObject({ used: 3 })
  })
  it('normal case unchanged: no screen, footer gauge, older /status', () => {
    expect(applyCodexScreen(stale, null)).toBe(stale)
    expect(applyCodexScreen(stale, { left: 60, exact: true })).toBe(stale)
    expect(applyCodexScreen(stale, { left: 20, exact: false })).toBe(stale)
    expect(applyCodexScreen(stale, { left: 90, exact: true, resets: '10:33 on 26 Sep' })).toBe(stale)
  })
})
