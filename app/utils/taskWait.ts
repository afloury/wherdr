// A task's sheet: its place in the queue for a free slot, and the tasks it
// waits for before it starts (herdr-projects `delegate --after`, `after --clear`).
// Machines are named by the label wherdr shows (`labelOf`), cut as 1.x cuts
// it (boardLabel): `vm-str:ELA-3` names task ELA-3 of machine vm-str.
import { type MachineTasks, type TaskGroup, afterRef, boardLabel, cleanAfterRefs, isTaskId, taskKey } from '../../shared/projectsTasks'
import { tl } from './i18n'

// "3rd in the queue", « 3e dans la file » (« 1re » : la file).
export function queuePlaceText(n: number): string {
  const tens = n % 100
  const en = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'
  return tl(`${n}${en} in the queue`, `${n}${n === 1 ? 're' : 'e'} dans la file`)
}

// One task to wait for, as the picker offers it.
export interface WaitChoice { ref: string, id: string, machine: string, title: string, group: TaskGroup }
const sameLabel = (a: string, b: string) => boardLabel(a).toLowerCase() === boardLabel(b).toLowerCase()

// The tasks of every machine the Board read that the task can wait for: not
// itself, not archived, not done (it would start at once). The task's own
// machine first, the latest first; `query` matches the key, id, title or machine.
export function waitChoices(machines: MachineTasks[], here: string, self: string, labelOf: (machine: string) => string, query = '', limit = 40): WaitChoice[] {
  const q = query.trim().toLowerCase()
  const out: WaitChoice[] = []
  const order = [...machines].sort((a, b) => Number(b.machine === here) - Number(a.machine === here))
  for (const m of order) {
    if (m.status !== 'ready') continue
    const label = m.machine === here ? null : labelOf(m.machine)
    const tasks = [...m.tasks].sort((a, b) => b.n - a.n || a.repo.localeCompare(b.repo))
    for (const t of tasks) {
      if (t.archived || t.group === 'done' || (m.machine === here && t.id === self)) continue
      const ref = afterRef(t.id, t.repoKey, label)
      if (q && !`${ref} ${t.id} #${t.n} ${t.title} ${label ?? ''}`.toLowerCase().includes(q)) continue
      out.push({ ref, id: t.id, machine: m.machine, title: t.title, group: t.group })
      if (out.length >= limit) return out
    }
  }
  return out
}

// What a person typed, kept as it is when the board can read it as a task
// (`DEMO-12`, `demo/12`, `vm-str:ELA-3`): one the Board does not list, or of a
// machine wherdr does not reach. The board says whether it exists.
export function typedRef(query: string): string | null {
  const q = query.trim()
  return q && cleanAfterRefs([q]) ? q : null
}

// A task a wait names (`repo/n`, or another machine's `label:repo/n`), as the
// Board names it: its key when its repo's is known (`DEMO-12`, `vm-str:ELA-3`).
export function waitName(id: string, here: string, machines: MachineTasks[], labelOf: (machine: string) => string): string {
  const i = id.indexOf(':')
  const label = i > 0 ? id.slice(0, i) : null
  const local = i > 0 ? id.slice(i + 1) : id
  if (!isTaskId(local)) return id
  const m = label === null ? machines.find(x => x.machine === here) : machines.find(x => x.machine !== here && sameLabel(labelOf(x.machine), label))
  const repo = local.split('/')[0]
  const key = m?.tasks.find(t => t.repo === repo && t.repoKey)?.repoKey
  const name = key ? taskKey(local, key) : local
  return label === null ? name : `${label}:${name}`
}
