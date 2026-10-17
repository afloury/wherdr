// herdr-projects comes in two unrelated lines under the same plugin id:
// - 0.2 (projects, TASKS.md, threads, inbox): the one wherdr reads.
// - 1.x (a task board, formerly herdr-superwork): not supported yet. Its first
//   run renames ~/.herdr-projects to ~/.herdr-projects-legacy.
//
// wherdr installs the 0.2 line from a fork that has no 1.x release: the
// plugin's own `herdr-projects update` installs the newest `vX.Y.Z` tag of the
// repository it came from, so an install from upstream, even pinned to
// v0.2.35, would be offered 1.x by its first update.
export const PROJECTS_REPO = 'afloury/herdr-projects'
export const PROJECTS_REPO_URL = `https://github.com/${PROJECTS_REPO}`
export const PROJECTS_UPSTREAM = 'eliasstravik/herdr-projects'
export const PROJECTS_REF = 'v0.2.36'
export const PROJECTS_INSTALL_ARGS = ['plugin', 'install', PROJECTS_REPO, '--ref', PROJECTS_REF, '--yes'] as const
export const PROJECTS_COMMAND = `herdr ${PROJECTS_INSTALL_ARGS.join(' ')}`
export const PROJECTS_UNINSTALL_COMMAND = 'herdr plugin uninstall herdr-projects'
// Back to the 0.2 line from 1.x or from an upstream 0.2. Projects stay in
// ~/.herdr-projects: uninstalling removes only Herdr's copy of the plugin.
export const PROJECTS_REINSTALL_COMMAND = `${PROJECTS_UNINSTALL_COMMAND} && ${PROJECTS_COMMAND}`
// Upstream guide to go back from 1.x to 0.2 once 1.x has run.
export const PROJECTS_LEGACY_GUIDE = `https://github.com/${PROJECTS_UPSTREAM}/blob/main/docs/old-installs.md`

export interface PluginCommand { command?: unknown }
export interface RawProjectsPlugin {
  plugin_id?: string
  enabled?: boolean
  version?: string
  plugin_root?: string
  startup?: PluginCommand[]
  actions?: PluginCommand[]
  panes?: PluginCommand[]
  source?: { kind?: string, owner?: string, repo?: string }
}

// Relative path of the herdr-projects program a 0.2 manifest runs
// (`target/release/herdr-projects`); null for 1.x, which runs `sh bin/run.sh`.
export function manifestBinary(p: RawProjectsPlugin): string | null {
  for (const c of [...(p.startup || []), ...(p.actions || []), ...(p.panes || [])]) {
    const argv = Array.isArray(c?.command) ? c.command : []
    const bin = typeof argv[0] === 'string' ? argv[0] : ''
    if (/(^|\/)herdr-projects$/.test(bin) && !bin.split('/').includes('..')) return bin
  }
  return null
}

const major = (version: string | undefined) => {
  const m = /^(\d+)\./.exec(version || '')
  return m ? Number(m[1]) : null
}

// True for the 1.x line: version 1 or later, or, without a readable version,
// a manifest with commands but no herdr-projects program.
export function isUnsupportedProjects(p: RawProjectsPlugin): boolean {
  const v = major(p.version)
  if (v !== null) return v >= 1
  const hasCommands = [...(p.startup || []), ...(p.actions || []), ...(p.panes || [])].length > 0
  return hasCommands && !manifestBinary(p)
}

// A 0.2 installed from upstream: its `herdr-projects update` would install 1.x.
export function updatesToUnsupported(p: RawProjectsPlugin): boolean {
  if (isUnsupportedProjects(p)) return false
  const s = p.source
  return Boolean(s && s.kind === 'github' && `${s.owner}/${s.repo}`.toLowerCase() === PROJECTS_UPSTREAM)
}
