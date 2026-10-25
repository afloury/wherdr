import { language } from './i18n'

// Board limits may use suffixes (30m); usage is a raw count. Unknown limits
// such as "none" remain readable rather than being guessed as zero.
export function tokenCount(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  const match = value?.trim().match(/^(\d+(?:[.,]\d+)?)\s*([kmb])?$/i)
  if (!match) return null
  const count = Number(match[1]!.replace(',', '.')) * ({ k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase() || ''] || 1)
  return Number.isFinite(count) ? count : null
}

export function formatTokens(value: number | string | null | undefined, lang = language): string {
  const n = tokenCount(value)
  if (n === null) return value == null || value === '' ? '—' : String(value)
  const unit = n >= 999_500 ? 1e6 : n >= 1000 ? 1e3 : 1
  const digits = unit === 1e6 && n < 10e6 ? 1 : 0
  return (n / unit).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: digits, useGrouping: false }) + (unit === 1e6 ? 'M' : unit === 1e3 ? 'k' : '')
}
