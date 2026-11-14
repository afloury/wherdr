// The Coordinators section's own order and its Hidden group (WHR-331), kept as
// synced settings: `order` lists project keys top to bottom, `hidden` the
// ones put aside. A coordinator not in `order` keeps its place after them.
export const HIDDEN_MARK = '\u0000hidden'

export function orderKeys(keys: readonly string[], order: readonly string[]): string[] {
  const at = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i }
  return [...keys].sort((a, b) => at(a) - at(b))
}

// After a drop: `slots` are the rows on screen in their new order, the Hidden
// group's mark among them (rows after it are hidden); `folded` the hidden rows
// not on screen (group collapsed), which stay hidden at its end. Keys of rows
// not listed here (another machine tab) keep their saved order and state.
export function dropSlots(slots: readonly string[], folded: readonly string[], prev: { order: readonly string[], hidden: readonly string[] }) {
  const mark = slots.indexOf(HIDDEN_MARK)
  const rows = [...slots.filter(k => k !== HIDDEN_MARK), ...folded]
  const seen = new Set(rows)
  return {
    order: [...rows, ...prev.order.filter(k => !seen.has(k))],
    hidden: [...prev.hidden.filter(k => !seen.has(k)), ...(mark < 0 ? [] : slots.slice(mark + 1)), ...folded],
  }
}

export const readKeys = (raw: string | null): string[] => {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [] }
  catch { return [] }
}
