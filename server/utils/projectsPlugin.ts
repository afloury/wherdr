import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import type { Machine } from './machines'
import { HerdrError, herdrOn } from './herdr'
import { PROJECTS_INSTALL_ARGS } from '../../shared/projectsPlugin'
import { fmt } from '../../shared/message'

export interface ProjectsPluginState {
  installed: boolean
  enabled: boolean
  version: string | null
  installable: boolean
}

export function projectsPluginFromList(plugins: { plugin_id?: string, enabled?: boolean, version?: string }[]): Pick<ProjectsPluginState, 'installed' | 'enabled' | 'version'> {
  const plugin = plugins.find(p => p.plugin_id === 'herdr-projects')
  return {
    installed: Boolean(plugin), enabled: Boolean(plugin && plugin.enabled !== false),
    version: plugin && typeof plugin.version === 'string' && /^\d[\w.+-]{0,39}$/.test(plugin.version) ? plugin.version : null,
  }
}

async function canInstall(m: Machine): Promise<boolean> {
  if (!m.local) return m.status === 'online'
  try {
    await fs.access(path.join(m.home, '.config/herdr'), constants.W_OK)
    return true
  } catch { return false }
}

export async function projectsPluginState(m: Machine): Promise<ProjectsPluginState> {
  if (m.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
  const r = await herdrOn<{ plugins?: { plugin_id?: string, enabled?: boolean, version?: string }[] }>(m.key, 'plugin.list', {}, 8000)
  return { ...projectsPluginFromList(r.plugins || []), installable: await canInstall(m) }
}

export async function installProjectsPlugin(m: Machine): Promise<string> {
  if (m.status !== 'online') throw new HerdrError('unreachable', fmt('{machine} is unreachable', { machine: m.label }))
  if ((await projectsPluginState(m)).installed) throw new HerdrError('already_installed', 'herdr-projects is already installed')
  if (!(await canInstall(m))) throw new HerdrError('read_only', fmt('Herdr folder is read-only on {machine}', { machine: m.label }))
  const child = m.spawnHerdr([...PROJECTS_INSTALL_ARGS])
  return await new Promise<string>((resolve, reject) => {
    let output = ''
    const append = (b: Buffer) => { output = (output + b.toString('utf8')).slice(-4000) }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000)
    child.on('error', e => { clearTimeout(timer); reject(new HerdrError('install_failed', e.message)) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new HerdrError('install_failed', output.trim().slice(-300) || fmt('Install failed (code {code})', { code })))
      else resolve(output.trim().slice(-300))
    })
  })
}
