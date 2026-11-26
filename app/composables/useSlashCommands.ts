// The commands and skills a conversation's agent offers after "/" (GET /api/commands): asked
// the first time a message starts with "/", then again once the answer is a little old. Kept
// per conversation and folder, outside the composer: another composer of the same conversation
// (the grid, a reopened pane) does not ask again. Only omp and Claude Code can say.
import type { Pane } from '#shared/types'
import { hasSlashList, type SlashCommand, type SlashList } from '#shared/slashCommands'

// The server keeps its own answer longer: asking again only costs a request.
const FRESH_MS = 30_000
const FAILED_MS = 10_000
const MAX_KEPT = 40

interface Entry { list: SlashList | null, at: number, asking: Promise<void> | null }
const entries = reactive(new Map<string, Entry>())

export function useSlashCommands(pane: () => Pane | undefined) {
  const key = computed(() => { const p = pane(); return p ? `${p.id}\0${p.cwd || ''}` : '' })
  const entry = computed(() => entries.get(key.value))
  const commands = computed<SlashCommand[]>(() => entry.value?.list?.commands ?? [])
  // 'loading': nothing to show yet; 'failed': the agent could not be asked; 'idle': not asked yet.
  // A refresh keeps showing the last answer.
  const status = computed<'idle' | 'loading' | 'ready' | 'failed'>(() => {
    const e = entry.value
    if (!e) return 'idle'
    if (e.list && !e.list.error) return 'ready'
    if (e.asking) return 'loading'
    return e.list ? 'failed' : 'idle'
  })

  // Asks unless the answer is fresh or being asked; `again`: also after a failure, now.
  function ensure(again = false) {
    const p = pane()
    if (!p || !hasSlashList(p.agent)) return
    const k = key.value
    let e = entries.get(k)
    if (!e) {
      entries.set(k, { list: null, at: 0, asking: null })
      e = entries.get(k)!
      if (entries.size > MAX_KEPT) entries.delete(entries.keys().next().value!)
    }
    if (e.asking) return
    const age = Date.now() - e.at
    if (e.list && !again && age < (e.list.error ? FAILED_MS : FRESH_MS)) return
    const agent = p.agent
    e.asking = api<SlashList>(`/api/commands?pane=${encodeURIComponent(p.id)}`)
      .then((l) => { e.list = l }, () => { if (!e.list || e.list.error) e.list = { agent, commands: [], error: 'unavailable' } })
      .finally(() => { e.at = Date.now(); e.asking = null })
  }

  return { commands, status, ensure }
}
