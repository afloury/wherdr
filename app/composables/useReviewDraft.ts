import type { ReviewAnchor, ReviewComment } from '#shared/review'

const isSide = (v: unknown) => v === 'old' || v === 'new'
const isLine = (v: unknown) => Number.isInteger(v) && (v as number) > 0
const isAnchor = (a: ReviewAnchor | undefined) => Boolean(a) && isLine(a!.number) && isSide(a!.side) && typeof a!.text === 'string'
const isRange = (r: unknown) => r === undefined || (Array.isArray(r) && r.length === 2 && r.every(isLine))
function valid(c: ReviewComment) {
  return c && typeof c.id === 'string' && ['working', 'committed'].includes(c.scope) && typeof c.path === 'string'
    && isAnchor(c) && typeof c.body === 'string'
    && (c.end === undefined || isAnchor(c.end))
    && (c.span === undefined || (typeof c.span === 'object' && c.span !== null && isRange(c.span.new) && isRange(c.span.old) && Boolean(c.span.new || c.span.old)))
    && (c.excerpt === undefined || (Array.isArray(c.excerpt) && c.excerpt.every(s => typeof s === 'string')))
    && (c.draft === undefined || typeof c.draft === 'string')
    && (c.hash === undefined || typeof c.hash === 'string')
}

function parse(raw: string | null): ReviewComment[] {
  try {
    const stored: unknown = JSON.parse(raw || '[]')
    // An editor left open with nothing written is not a draft worth restoring.
    return Array.isArray(stored) ? stored.filter(c => valid(c) && (c.body.trim() || c.draft?.trim())) : []
  } catch { return [] }
}

export function useReviewDraft(paneId: string) {
  const key = `review:${paneId}`
  const comments = ref<ReviewComment[]>([])
  try { comments.value = parse(localStorage.getItem(key)) } catch { /* Storage may be unavailable. Keep the draft in this view. */ }
  watch(comments, value => {
    try {
      const json = value.length ? JSON.stringify(value) : null
      if (json === localStorage.getItem(key)) return
      if (json) localStorage.setItem(key, json)
      else localStorage.removeItem(key)
    } catch { /* Keep the in-memory draft when storage is full. */ }
  }, { deep: true, flush: 'sync' })
  // The same agent open in another tab: each view writes the whole list, so
  // take the other tab's list before writing over it. A comment being written
  // here keeps its text.
  function other(e: StorageEvent) {
    if (e.key !== key && e.key !== null) return
    const mine = new Map(comments.value.filter(c => c.draft !== undefined).map(c => [c.id, c]))
    comments.value = parse(e.key === null ? null : e.newValue).map(c => mine.get(c.id) ?? c)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', other)
    onScopeDispose(() => window.removeEventListener('storage', other))
  }
  return comments
}
