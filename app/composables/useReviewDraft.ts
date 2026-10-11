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

export function useReviewDraft(paneId: string) {
  const key = `review:${paneId}`
  const comments = ref<ReviewComment[]>([])
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    // An editor left open with nothing written is not a draft worth restoring.
    if (Array.isArray(stored)) comments.value = stored.filter(c => valid(c) && (c.body.trim() || c.draft?.trim()))
  } catch { /* Storage may be unavailable. Keep the draft in this view. */ }
  watch(comments, value => {
    try {
      if (value.length) localStorage.setItem(key, JSON.stringify(value))
      else localStorage.removeItem(key)
    } catch { /* Keep the in-memory draft when storage is full. */ }
  }, { deep: true, flush: 'sync' })
  return comments
}
