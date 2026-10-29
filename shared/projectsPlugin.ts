// herdr-projects: wherdr reads the 1.x line (a task board, upstream
// eliasstravik/herdr-projects) from 1.2.1 on, through its own CLI
// (`version`, `list --json`, `details <id> --json`…), see shared/projectsTasks.ts.
//
// The 0.2 line (projects, TASKS.md, threads) is no longer read: wherdr 1.3.4
// is the last version that does. A 0.2, or a 1.x older than 1.2.1, gets a
// message with the commands to update herdr-projects or to go back to wherdr 1.3.4.
//
// Every 1.x command but `version` and `help` first takes over the files of an
// older install (it renames a 0.2 ~/.herdr-projects to ~/.herdr-projects-legacy).
// So wherdr runs it only where 1.x is the plugin Herdr has installed.
export const PROJECTS_REPO = 'eliasstravik/herdr-projects'
export const PROJECTS_REPO_URL = `https://github.com/${PROJECTS_REPO}`
// The oldest 1.x whose `list --json` and `details --json` wherdr was checked against.
export const PROJECTS_MIN = '1.2.1'
// The release wherdr installs and offers to update to: the newest one its
// commands were checked against (tests/recordings/herdr-projects-<version>).
// The one place to bump for a new release: docs/RELEASING.md says how.
export const PROJECTS_TESTED = '1.2.21'
export const PROJECTS_REF = `v${PROJECTS_TESTED}`
export const PROJECTS_INSTALL_ARGS = ['plugin', 'install', PROJECTS_REPO, '--ref', PROJECTS_REF, '--yes'] as const
export const PROJECTS_COMMAND = `herdr ${PROJECTS_INSTALL_ARGS.join(' ')}`
export const PROJECTS_UNINSTALL_COMMAND = 'herdr plugin uninstall herdr-projects'
// From a 0.2 or an older 1.x: Herdr's copy of the plugin is replaced. A 0.2's
// projects are set aside by 1.x's first run, never deleted (docs/herdr-projects-1x.md).
export const PROJECTS_UPGRADE_COMMAND = `${PROJECTS_UNINSTALL_COMMAND} && ${PROJECTS_COMMAND}`
// The other way: the last wherdr that reads herdr-projects 0.2.
export const WHERDR_LAST_02 = '1.3.4'
// npm command for the last compatible version.
export const WHERDR_DOWNGRADE_COMMANDS = [
  `npm install -g wherdr@${WHERDR_LAST_02}`,
] as const
// The command herdr-projects 1.x gives agents and hooks, written by any of its
// runs (flow/send.rs `shim`): 1.2.1 does not put `herdr-projects` on the PATH
// (its `doctor` says so), so commands for the host name this path.
export const PROJECTS_LAUNCHER = '~/.herdr-projects/data/bin/herdr-projects'

// The step-by-step guide: in wherdr's repository, and shipped in the npm package
// (package.json `files`; tests/projectsPlugin.test.ts checks both).
export const PROJECTS_MIGRATION_GUIDE = 'docs/herdr-projects-1x.md'
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

// a >= b, part by part as numbers (1.10.0 is newer than 1.9.2); false when either is unreadable.
export function versionAtLeast(a: string | null | undefined, b: string): boolean {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null)
  const x = parse((a || '').trim().replace(/^v/, '').replace(/[-+].*$/, ''))
  const y = parse(b)
  if (!x || !y) return false
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d > 0
  }
  return true
}

// The script a 1.x manifest runs every command through (`sh bin/run.sh …`),
// as an absolute path; null when the manifest does not say so (a 0.2 runs
// `target/release/herdr-projects`).
export function projectsLauncher(p: RawProjectsPlugin): string | null {
  if (typeof p.plugin_root !== 'string' || !p.plugin_root.startsWith('/') || p.plugin_root.split('/').includes('..')) return null
  for (const c of [...(p.actions || []), ...(p.startup || []), ...(p.panes || [])]) {
    const argv = Array.isArray(c?.command) ? c.command : []
    if (argv[0] === 'sh' && argv[1] === 'bin/run.sh') return `${p.plugin_root.replace(/\/+$/, '')}/bin/run.sh`
  }
  return null
}

// Where herdr-projects stands on a machine, as Herdr's plugin list says.
// - missing: not installed;
// - old: a 0.2, or a 1.x older than 1.2.1, or one without its launcher;
// - shepherdr: unsupported Shepherdr 2.x;
// - disabled: switched off in Herdr;
// - ready: wherdr reads it.
export type ProjectsStatus = 'missing' | 'old' | 'shepherdr' | 'disabled' | 'ready'

const VERSION_RE = /^\d[\w.+-]{0,39}$/
export function cleanVersion(v: unknown): string | null {
  return typeof v === 'string' && VERSION_RE.test(v) ? v : null
}

export function projectsStatus(p: RawProjectsPlugin | null | undefined): ProjectsStatus {
  if (!p) return 'missing'
  // Shepherdr keeps the plugin id, but has a different CLI and data contract.
  // Inspect metadata only: never run its startup, CLI or migration.
  const commands = [...(p.actions || []), ...(p.startup || []), ...(p.panes || [])]
  if (versionAtLeast(cleanVersion(p.version), '2.0.0') || commands.some(c => {
    const argv = Array.isArray(c?.command) ? c.command : []
    return (argv[0] === 'sh' && argv[1] === 'scripts/need-bun.sh' && argv[2] === 'scripts/plugin.ts')
      || argv[0] === 'bin/shepherdr' || (argv[0] === 'sh' && argv[1] === 'bin/shepherdr')
  })) return 'shepherdr'
  if (!versionAtLeast(cleanVersion(p.version), PROJECTS_MIN) || !projectsLauncher(p)) return 'old'
  return p.enabled === false ? 'disabled' : 'ready'
}

// The program's own version, from `herdr-projects version` ("herdr-projects
// 1.2.21 (/path/to/binary)"). It can be newer than Herdr's manifest says:
// `herdr-projects update` replaces the program, not the manifest.
export function parseProjectsVersion(stdout: string): string | null {
  const m = /^herdr-projects v?(\S+)/.exec(stdout.trim())
  return m ? cleanVersion(m[1]) : null
}

// A herdr-projects 1.x wherdr reads (1.2.1 or later) that is older than the
// release wherdr was tested with: wherdr offers to update it.
export function projectsBehind(version: string | null | undefined): boolean {
  return versionAtLeast(version, PROJECTS_MIN) && !versionAtLeast(version, PROJECTS_TESTED)
}

export function findProjectsPlugin(plugins: unknown): RawProjectsPlugin | null {
  if (!Array.isArray(plugins)) return null
  return (plugins as RawProjectsPlugin[]).find(p => p && typeof p === 'object' && p.plugin_id === 'herdr-projects') || null
}
