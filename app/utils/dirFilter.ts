// Folder pickers (recent folders, browser subfolders): name filter and chip names.
import { foldSearch } from '../../shared/searchText'

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
export function folderLabels(paths: string[]): string[] {
  const names = paths.map(p => p.split('/').pop() || '~')
  return names.map((n, i) => (names.indexOf(n) === names.lastIndexOf(n) ? n : paths[i]!.split('/').slice(-2).join('/')))
}
