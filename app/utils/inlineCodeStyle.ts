// TEMPORARY (design proposals): which drawing of inline code in replies to use.
// "0" is the current one; "a" to "c" are the proposals, picked with
// `?codev=a` in the address (remembered on the device) and applied as
// `data-codev` on <html> (main.css). Removed once one is chosen.
export const INLINE_CODE_STYLES = ['0', 'a', 'b', 'c'] as const
export type InlineCodeStyle = typeof INLINE_CODE_STYLES[number]

const valid = (v: unknown): v is InlineCodeStyle => INLINE_CODE_STYLES.includes(v as InlineCodeStyle)

export function pickInlineCodeStyle(query: string | null, stored: string | null): InlineCodeStyle {
  if (valid(query)) return query
  return valid(stored) ? stored : '0'
}

export function installInlineCodeStyle() {
  try {
    const q = new URLSearchParams(location.search).get('codev')
    const v = pickInlineCodeStyle(q, localStorage.getItem('inlineCodeStyle'))
    if (valid(q)) localStorage.setItem('inlineCodeStyle', q)
    document.documentElement.dataset.codev = v
  } catch { document.documentElement.dataset.codev = '0' }
}
