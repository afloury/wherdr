import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import type { Machine } from './machines'
import { HerdrError, herdrOn } from './herdr'
import { PROJECTS_INSTALL_ARGS, PROJECTS_TESTED, type ProjectsStatus, type RawProjectsPlugin, cleanVersion, findProjectsPlugin, projectsBehind, projectsLauncher, projectsStatus } from '../../shared/projectsPlugin'
import { fmt } from '../../shared/message'

export interface ProjectsPluginState {
  status: ProjectsStatus
  version: string | null
  installable: boolean
  // The program's own version (`herdr-projects version`), only where wherdr
  // runs it (ready); null when unknown. See parseProjectsVersion.
  program?: string | null
}

export function projectsPluginFromList(plugins: RawProjectsPlugin[]): Omit<ProjectsPluginState, 'installable'> {
  const plugin = findProjectsPlugin(plugins)
  return { status: projectsStatus(plugin), version: cleanVersion(plugin?.version) }
}

// herdr-projects on a machine, kept 10 s: the Board asks on every read (a cheap
// Herdr call, not the plugin), and an update shows soon after.
// `launcher`: its bin/run.sh, only when wherdr can run it (status ready).
export interface ProjectsPluginInfo extends Omit<ProjectsPluginState, 'installable'> { launcher: string | null }
const PLUGIN_TTL_MS = 10_000
const infos = new Map<string, { at: number, info: Promise<ProjectsPluginInfo> }>()
export function projectsPluginInfo(m: Machine, fresh = false): Promise<ProjectsPluginInfo> {
  const hit = infos.get(m.key)
  if (!fresh && hit && Date.now() - hit.at < PLUGIN_TTL_MS) return hit.info
  const info = herdrOn<{ plugins?: RawProjectsPlugin[] }>(m.key, 'plugin.list', {}, 8000).then((r) => {
    const plugin = findProjectsPlugin(r.plugins || [])
    const status = projectsStatus(plugin)
    return { status, version: cleanVersion(plugin?.version), launcher: status === 'ready' && plugin ? projectsLauncher(plugin) : null }
  })
  info.catch(() => infos.delete(m.key))
  infos.set(m.key, { at: Date.now(), info })
  return info
}

// The pinned release downloads a prebuilt binary; allow two minutes for
// the checkout and download, including on a slower connection.
const INSTALL_TIMEOUT_MS = 2 * 60 * 1000

async function canInstall(m: Machine): Promise<boolean> {
  if (!m.local) return m.status === 'online'
  try {
    await fs.access(path.join(m.home, '.config/herdr'), constants.W_OK)
    return true
  } catch { return false }
}

export async function projectsPluginState(m: Machine): Promise<ProjectsPluginState> {
  if (m.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
  const { status, version } = await projectsPluginInfo(m, true)
  return { status, version, installable: await canInstall(m) }
}

export async function installProjectsPlugin(m: Machine): Promise<string> {
  if (m.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
  if ((await projectsPluginState(m)).status !== 'missing') throw new HerdrError('already_installed', 'herdr-projects is already installed')
  return runInstall(m)
}

// A 1.x wherdr reads, older than PROJECTS_TESTED: the same install, over it.
// Herdr replaces its copy of the plugin ("replaces: …"); the tasks and settings
// in ~/.herdr-projects stay. `program`: its version as `herdr-projects version`
// says (the manifest's can be older), so a newer program is never taken back.
export async function updateProjectsPlugin(m: Machine, program: string | null): Promise<string> {
  if (m.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
  if ((await projectsPluginState(m)).status !== 'ready' || !projectsBehind(program)) {
    throw new HerdrError('up_to_date', fmt('herdr-projects is already {version} or later', { version: PROJECTS_TESTED }))
  }
  return runInstall(m)
}

async function runInstall(m: Machine): Promise<string> {
  if (!(await canInstall(m))) throw new HerdrError('read_only', fmt('Herdr folder is read-only on {machine}', { machine: m.label }))
  const child = m.spawnHerdr([...PROJECTS_INSTALL_ARGS])
  return await new Promise<string>((resolve, reject) => {
    let output = ''
    const append = (b: Buffer) => { output = (output + b.toString('utf8')).slice(-4000) }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => child.kill('SIGKILL'), INSTALL_TIMEOUT_MS)
    child.on('error', e => { clearTimeout(timer); reject(new HerdrError('install_failed', e.message)) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new HerdrError('install_failed', output.trim().slice(-300) || fmt('Install failed (code {code})', { code })))
      else { infos.delete(m.key); resolve(output.trim().slice(-300)) }
    })
  })
}
