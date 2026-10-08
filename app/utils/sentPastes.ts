// Pasted texts this device sent (message field cards, see shared/pastedText.ts):
// Codex and omp keep no trace of a paste, and in Claude's transcript the whole
// wherdr send is one paste. Remembered here to show them back as cards in the
// conversation. Bounded: the last 20, at most 400 000 characters.
import { ref } from 'vue'

const KEY = 'sentPastes'
const MAX = 20
const MAX_CHARS = 400000

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  } catch { return [] }
}

export const sentPastes = ref<string[]>(import.meta.client ? load() : [])

export function rememberPastes(blocks: string[]) {
  if (!blocks.length) return
  const list = [...blocks.map(b => b.trim()), ...sentPastes.value.filter(s => !blocks.some(b => b.trim() === s))].slice(0, MAX)
  let total = 0
  const kept = list.filter((s) => {
    total += s.length
    return total <= MAX_CHARS
  })
  sentPastes.value = kept
  try { localStorage.setItem(KEY, JSON.stringify(kept)) } catch { /* storage full or unavailable */ }
}
