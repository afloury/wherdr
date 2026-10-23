// Task limits (herdr-projects 1.2.16+, docs/limits.md upstream): `limit.time`
// caps one run of an agent, `limit.tokens` the whole task. herdr-projects
// writes them as `2h`, `45m`, `90s`, `1h12m` (crates/flow/src/limits/run.rs
// time_say) and `2m`, `1.5m`, `500k` tokens (store/settings/values.rs
// tokens_say). Here: reading those back, saying them to a person ("2 h",
// "45 min", "3.4 M", "500 k", same rounding as herdr-projects), and writing a
// raised limit the way `herdr-projects set` takes it.

export type LimitKind = 'time' | 'tokens'
export const LIMIT_KINDS: readonly LimitKind[] = ['time', 'tokens']
export const NO_LIMIT = 'none'

const H = 3_600_000
const MIN = 60_000

// `2h`, `45m`, `90s`, `1h12m`, `2m38s` → ms. null: `none` or not a time.
export function parseLimitTime(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return Number(m[1] || 0) * H + Number(m[2] || 0) * MIN + Number(m[3] || 0) * 1000
}

// `2m`, `1.5m`, `500k`, `2b`, a raw count (number or digits) → tokens.
// `1,2m` is read as 1.2m. null: `none` or not a count.
export function parseTokenCount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(\d+(?:[.,]\d+)?)\s*([kmb])?$/i)
  if (!m) return null
  const n = Number(m[1]!.replace(',', '.')) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase() || ''] || 1)
  return Number.isFinite(n) ? n : null
}

type Lang = 'en' | 'fr'
const decimal = (lang: Lang) => (lang === 'fr' ? ',' : '.')

// A time as herdr-projects says it, spaced for reading: "2 h", "1 h 12",
// "45 min", "2 min 38", "30 s". Seconds only under ten minutes.
export function formatDuration(ms: number): string {
  const s = Math.round(Math.max(0, ms) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const x = s % 60
  if (h > 0) return m > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
  if (m >= 10 || (m > 0 && x === 0)) return `${m} min`
  if (m > 0) return `${m} min ${String(x).padStart(2, '0')}`
  return `${s} s`
}

// A token count as herdr-projects says it (2 decimals under 10, 1 under 100,
// trailing zeros cut), with an upper-case M so it never reads as minutes:
// "3.4 M", "1.25 M", "500 k", "800". French: "3,4 M".
export function formatTokenCount(n: number, lang: Lang = 'en'): string {
  const x = Math.max(0, Math.round(n))
  const cut = (v: number) => {
    const p = v < 10 ? 2 : v < 100 ? 1 : 0
    let s = v.toFixed(p)
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
    return s.replace('.', decimal(lang))
  }
  if (x >= 1e6) return `${cut(x / 1e6)} M`
  if (x >= 1e3) return `${cut(x / 1e3)} k`
  return String(x)
}

// A limit's value as written on the board, for a person: `none` stays a word,
// anything unknown is shown as it is.
export function formatLimit(kind: LimitKind, value: string, lang: Lang = 'en'): string {
  if (kind === 'time') { const ms = parseLimitTime(value); return ms === null ? value : formatDuration(ms) }
  const n = parseTokenCount(value)
  return n === null ? value : formatTokenCount(n, lang)
}

// What `herdr-projects set limit.time` takes: one number and one unit (its
// `ms()` reads no more), so 1h30 is written `90m`.
export function limitTimeValue(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s % 3600 === 0) return `${s / 3600}h`
  if (s % 60 === 0) return `${s / 60}m`
  return `${s}s`
}
// What `herdr-projects set limit.tokens` takes: `40m`, `1500k`, a count.
export function limitTokensValue(n: number): string {
  const x = Math.max(1, Math.round(n))
  if (x % 1e6 === 0) return `${x / 1e6}m`
  if (x % 1e3 === 0) return `${x / 1e3}k`
  return String(x)
}

// A value `set limit.<kind>` may be given here: `none`, a time with one unit,
// a count with an optional k/m/b. herdr-projects still has the last word.
export function isLimitValue(kind: LimitKind, v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 20) return false
  if (v === NO_LIMIT) return true
  return kind === 'time' ? /^[1-9]\d*[smh]$/.test(v) : /^(?:[1-9]\d*|\d+\.\d+)[kmb]?$/.test(v) && (parseTokenCount(v) ?? 0) >= 1
}

// The ways the raise sheet offers: time +1 h, ×2, none; tokens ×2, +10 M,
// none. `value`: what `set` is given. `resumes`: the new limit is above what
// was used, so herdr-projects carries on by itself (limits/reached.rs
// `lifted`); a preset that would not is offered disabled.
export interface LimitPreset { id: string, value: string, resumes: boolean }
export function raisePresets(kind: LimitKind, limit: string, used: number | null): LimitPreset[] {
  const above = (n: number) => used === null || n > used
  if (kind === 'time') {
    const ms = parseLimitTime(limit)
    if (ms === null) return [{ id: 'none', value: NO_LIMIT, resumes: true }]
    return [
      { id: 'plus1h', value: limitTimeValue(ms + H), resumes: above(ms + H) },
      { id: 'double', value: limitTimeValue(ms * 2), resumes: above(ms * 2) },
      { id: 'none', value: NO_LIMIT, resumes: true },
    ]
  }
  const n = parseTokenCount(limit)
  if (n === null) return [{ id: 'none', value: NO_LIMIT, resumes: true }]
  return [
    { id: 'double', value: limitTokensValue(n * 2), resumes: above(n * 2) },
    { id: 'plus10m', value: limitTokensValue(n + 10e6), resumes: above(n + 10e6) },
    { id: 'none', value: NO_LIMIT, resumes: true },
  ]
}

// One gauge: what has been used of a limit, 0 to 1 (more when a turn passed
// it). null: nothing to measure against (no limit, or used not known).
export function limitShare(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null || limit <= 0) return null
  return used / limit
}
// From this share on the gauge turns red.
export const LIMIT_HOT = 0.9

// What stopped a task at a limit: `details.limits.stopped` (1.2.16+), else
// the board's own line (`stopped at its 2h limit`, `stopped at 2m tokens`,
// limits/run.rs stop_line). `limit`: the value in force now (a later `set`
// wins over the one it stopped at); `used`: ms or tokens, when known.
export interface LimitStop { kind: LimitKind, limit: string, used: number | null }
interface StopSource {
  time?: string, tokens?: string, timeUsedMs?: number | null, tokensCounted?: number | null
  stopped?: { what: LimitKind, limit: string, used: number | null } | null
}
export function limitStopOf(limits: StopSource | null | undefined, msg: string | null | undefined): LimitStop | null {
  const s = limits?.stopped
  let kind: LimitKind | null = s?.what ?? null
  let at = s?.limit || ''
  if (!kind) {
    const m = (msg || '').match(/^stopped at its (\S+) limit\b/i)
    const n = m ? null : (msg || '').match(/^stopped at (\S+) tokens\b/i)
    if (m) { kind = 'time'; at = m[1]! }
    else if (n) { kind = 'tokens'; at = n[1]! }
  }
  if (!kind) return null
  const now = limits?.[kind]
  const limit = now && now !== NO_LIMIT && (kind === 'time' ? parseLimitTime(now) : parseTokenCount(now)) !== null ? now : at
  const used = kind === 'tokens' ? (limits?.tokensCounted ?? s?.used ?? null) : (s?.used ?? null)
  return { kind, limit, used }
}
