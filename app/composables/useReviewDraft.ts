import type { ReviewComment } from '#shared/review'

export function useReviewDraft(paneId: string) {
  const key = `review:${paneId}`
  const comments = ref<ReviewComment[]>([])
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    if (Array.isArray(stored)) comments.value = stored.filter(c => c && typeof c.id === 'string' && ['working', 'committed'].includes(c.scope) && typeof c.path === 'string' && Number.isInteger(c.number) && c.number > 0 && ['old', 'new'].includes(c.side) && typeof c.text === 'string' && typeof c.body === 'string')
  } catch { /* Storage may be unavailable. Keep the draft in this view. */ }
  watch(comments, value => {
    try {
      if (value.length) localStorage.setItem(key, JSON.stringify(value))
      else localStorage.removeItem(key)
    } catch { /* Keep the in-memory draft when storage is full. */ }
  }, { deep: true, flush: 'sync' })
  return comments
}
