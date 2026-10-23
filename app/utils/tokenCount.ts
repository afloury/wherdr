import { formatTokenCount, parseTokenCount } from '../../shared/taskLimits'
import { language } from './i18n'

// Board limits may use suffixes (30m); usage is a raw count. Unknown limits
// such as "none" remain readable rather than being guessed as zero. The
// formatting itself is shared/taskLimits.ts, the one place that says counts.
export const tokenCount = (value: number | string | null | undefined): number | null => parseTokenCount(value)

export function formatTokens(value: number | string | null | undefined, lang = language): string {
  const n = tokenCount(value)
  if (n === null) return value == null || value === '' ? '—' : String(value)
  return formatTokenCount(n, lang)
}
