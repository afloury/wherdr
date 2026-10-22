import type { BoardSections, CoordinatorLevel, Member } from '#shared/boardLinks'
import type { Row } from '#shared/spaces'

export type HomeGrouping = 'machine' | 'state'

export function readHomeGrouping(value: unknown): HomeGrouping {
  return value === 'state' ? 'state' : 'machine'
}

export interface StateEntry {
  row: Row
  repo?: string
  level?: CoordinatorLevel
  member?: Member
}

// Flatten each machine separately: repositories with the same name on two
// machines must retain their own coordinator, task metadata and board links.
export function stateEntries(sections: BoardSections, showShells: boolean): StateEntry[] {
  const entries: StateEntry[] = sections.coordinators.map(c => ({ row: c.row, level: c.level }))
  for (const p of sections.projects) {
    if (p.coordinator) entries.push({ row: p.coordinator, repo: p.repo, level: 'project' })
    if (p.space && (p.space.lead.agent || showShells)) entries.push({ row: p.space, repo: p.repo })
    for (const member of p.members) {
      if (member.row.lead.agent || showShells) entries.push({ row: member.row, repo: p.repo, member })
    }
  }
  entries.push(...sections.others.filter(r => r.lead.agent || showShells).map(row => ({ row })))
  return entries
}
