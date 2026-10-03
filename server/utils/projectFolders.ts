// herdr-projects folders among a machine's folders (recent folders, browser
// entries): candidates by path under the projects roots, confirmed by the
// project's PROJECT.md. See shared/projectFolders.ts.
import type { Machine } from './machines'
import { type ProjectFolderKind, projectFolderCandidate, projectsRoots } from '../../shared/projectFolders'

const ROOTS_TTL_MS = 60_000
const roots = new Map<string, { at: number, roots: Promise<string[]> }>()

function rootsOn(m: Machine): Promise<string[]> {
  const hit = roots.get(m.key)
  if (hit && Date.now() - hit.at < ROOTS_TTL_MS) return hit.roots
  const home = m.home.replace(/\/+$/, '')
  const r = m.fs.readFile(`${home}/.config/herdr-projects/config.toml`)
    .catch(() => null)
    .then(text => projectsRoots(home, text))
  roots.set(m.key, { at: Date.now(), roots: r })
  return r
}

// Kind of each herdr-projects folder among `dirs` (others are absent).
// Never throws: an unreachable machine marks nothing.
export async function projectFolderKinds(m: Machine, dirs: string[]): Promise<Record<string, ProjectFolderKind>> {
  if (!m.home || !dirs.length) return {}
  try {
    const rs = await rootsOn(m)
    const found = dirs.map(d => ({ d, c: projectFolderCandidate(d, rs) })).filter(x => x.c)
    if (!found.length) return {}
    const projects = [...new Set(found.map(x => x.c!.projectDir))]
    const stats = await m.fs.statMany(projects.map(p => `${p}/PROJECT.md`))
    const real = new Set(projects.filter((_, i) => stats[i]?.isFile))
    const out: Record<string, ProjectFolderKind> = {}
    for (const { d, c } of found) if (real.has(c!.projectDir)) out[d] = c!.kind
    return out
  } catch { return {} }
}
