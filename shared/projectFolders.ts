// herdr-projects folders among the folder pickers (recent folders, browser):
// a project folder (`<root>/<slug>`, where the coordinator works) or one of its
// thread folders (`<root>/<slug>/threads/t-NNNN`). The project folder is
// named like the project and often like its repository: the pickers mark it.
export type ProjectFolderKind = 'project' | 'thread'

export interface ProjectFolderCandidate { kind: ProjectFolderKind, projectDir: string }

const SLUG = /^[^/.][^/]*$/
const THREAD = /^t-\d{4,}$/

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const under = (home: string, rest: string) => `${trimSlash(home)}/${rest}`.replace(/\/{2,}/g, '/')

// Candidate by path only, under one of the projects roots; the caller then
// checks that `<projectDir>/PROJECT.md` exists.
export function projectFolderCandidate(dir: string, roots: string[]): ProjectFolderCandidate | null {
  const d = trimSlash(dir)
  if (!d.startsWith('/')) return null
  for (const r of roots) {
    const root = trimSlash(r)
    if (!root || root === '/' || !d.startsWith(root + '/')) continue
    const parts = d.slice(root.length + 1).split('/')
    if (!SLUG.test(parts[0]!)) continue
    const projectDir = `${root}/${parts[0]}`
    if (parts.length === 1) return { kind: 'project', projectDir }
    if (parts.length === 3 && parts[1] === 'threads' && THREAD.test(parts[2]!)) return { kind: 'thread', projectDir }
  }
  return null
}

// `root = "…"` at the top level of ~/.config/herdr-projects/config.toml
// (before any table), `~/` expanded; null when absent or not absolute.
export function projectsRootFromConfig(text: string, home: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) break
    const m = /^root\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(?:#.*)?$/.exec(line)
    if (!m) continue
    const value = (m[1] ?? m[2] ?? '').trim()
    if (!value) return null
    const abs = value.startsWith('~/') ? under(home, value.slice(2)) : value
    return abs.startsWith('/') && !abs.split('/').includes('..') ? trimSlash(abs.replace(/\/{2,}/g, '/')) : null
  }
  return null
}

// Default root and the configured one (herdr-projects order, without the
// HERDR_PROJECTS_ROOT variable, which only lives in the agents' environment).
export function projectsRoots(home: string, configText: string | null): string[] {
  const roots = [under(home, '.herdr-projects')]
  const configured = configText ? projectsRootFromConfig(configText, home) : null
  if (configured && !roots.includes(configured)) roots.unshift(configured)
  return roots
}
