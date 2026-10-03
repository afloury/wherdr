// Folder pickers (recent folders, browser subfolders): name filter and chip names.
import { foldSearch } from '../../shared/searchText'
import type { ProjectFolderKind } from '../../shared/projectFolders'
import { tl } from './i18n'

// Items whose name contains `query`, ignoring case and accents. Names starting
// with it come first; each group keeps the given order (recency, or Git then A→Z).
export function filterByName<T>(items: T[], query: string, name: (item: T) => string): T[] {
  const needle = foldSearch(query.trim())
  if (!needle) return items
  const starts: T[] = []
  const contains: T[] = []
  for (const item of items) {
    const at = foldSearch(name(item)).indexOf(needle)
    if (at === 0) starts.push(item)
    else if (at > 0) contains.push(item)
  }
  return [...starts, ...contains]
}

// Chip names of folders (paths already shortened, `~/…`): the last segment,
// or `parent/name` when several folders share it (worktrees of one repository).
// A herdr-projects project folder (`kinds[i] === 'project'`) that shares its
// name with another folder (usually its repository) gets `projectSuffix`
// instead ("wherdr · project" next to "wherdr").
export function folderLabels(paths: string[], kinds: (ProjectFolderKind | undefined)[] = [], projectSuffix = ' · project'): string[] {
  const names = paths.map(p => p.split('/').pop() || '~')
  const isProject = (i: number) => kinds[i] === 'project'
  return names.map((n, i) => {
    const same = names.flatMap((m, j) => (m === n ? [j] : []))
    if (same.length === 1) return n
    const sameKind = same.filter(j => isProject(j) === isProject(i))
    const label = sameKind.length === 1 ? n : paths[i]!.split('/').slice(-2).join('/')
    return isProject(i) ? label + projectSuffix : label
  })
}

// Tooltip of a herdr-projects folder marker.
export function projectFolderHint(kind: ProjectFolderKind): string {
  return kind === 'project'
    ? tl('herdr-projects project folder (coordinator) — not the repository', 'Dossier de projet herdr-projects (coordinateur) — pas le dépôt')
    : tl('herdr-projects thread folder — not the repository', 'Dossier de thread herdr-projects — pas le dépôt')
}
