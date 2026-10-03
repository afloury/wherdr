// TEMPORARY (design proposals): which drawing of omp's tool calls to use.
// "0" is the current one; "a" to "d" are the proposals, picked with
// `?ompv=a` in the address (remembered on the device). Removed once one is chosen.
import { ref } from 'vue'

export const OMP_TOOL_STYLES = ['0', 'a', 'b', 'c', 'd'] as const
export type OmpToolStyle = typeof OMP_TOOL_STYLES[number]

const valid = (v: unknown): v is OmpToolStyle => OMP_TOOL_STYLES.includes(v as OmpToolStyle)

function initial(): OmpToolStyle {
  if (typeof window === 'undefined') return '0'
  try {
    const q = new URLSearchParams(location.search).get('ompv')
    if (valid(q)) {
      localStorage.setItem('ompToolStyle', q)
      return q
    }
    const s = localStorage.getItem('ompToolStyle')
    return valid(s) ? s : '0'
  } catch { return '0' }
}

export const ompToolStyle = ref<OmpToolStyle>(initial())

// Uppercase tool name for badges and segments ("BASH", "WEB SEARCH").
export const ompKind = (title: string) => title.toUpperCase()

// The call as a shell-like command line, for the terminal frame (variant d):
// bash is its command, the others "read TASKS.md:5-20", "grep ompActivity".
export function ompCommandLine(title: string, target?: string): string {
  if (title === 'Bash') return target || ''
  const name = title.toLowerCase().replace(/\s+/g, '_')
  return target ? `${name} ${target}` : name
}

// Total wall time of a group of calls (ms), for the frame's header.
export const ompTotalMs = (list: readonly { omp?: { ms?: number } }[]) =>
  list.reduce((s, t) => s + (t.omp && typeof t.omp.ms === 'number' ? t.omp.ms : 0), 0)
