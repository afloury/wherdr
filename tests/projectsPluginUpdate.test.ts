// Settings › Plugins › herdr-projects: Install and Update run Herdr's install
// of the tested release; Update only over a 1.x older than it.
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECTS_TESTED } from '../shared/projectsPlugin'

const plugins = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('../server/utils/herdr', async (orig) => ({
  ...(await orig<typeof import('../server/utils/herdr')>()),
  herdrOn: async () => ({ plugins: plugins.list }),
}))
const { installProjectsPlugin, updateProjectsPlugin } = await import('../server/utils/projectsPlugin')

const manifest = (version: string) => ({
  plugin_id: 'herdr-projects', enabled: true, version, plugin_root: '/home/user/.config/herdr/plugins/github/herdr-projects-4567',
  startup: [{ command: ['sh', 'bin/run.sh', 'hook'] }],
})
// A remote machine whose `herdr` exits 0, writing down what it ran.
function machine() {
  const runs: string[][] = []
  const m = {
    key: 'devbox', label: 'devbox', status: 'online', local: false, home: '/home/user',
    spawnHerdr(args: string[]) {
      runs.push(args)
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true })
      setTimeout(() => { child.stdout.emit('data', Buffer.from('replaces: herdr-projects\nInstalled herdr-projects')); child.emit('close', 0) }, 0)
      return child
    },
  }
  return { m: m as unknown as Parameters<typeof updateProjectsPlugin>[0], runs }
}

beforeEach(() => { plugins.list = [] })

describe('Update herdr-projects', () => {
  it('installs the tested release over a 1.x older than it', async () => {
    plugins.list = [manifest('1.2.1')]
    const { m, runs } = machine()
    await expect(updateProjectsPlugin(m, '1.2.16')).resolves.toContain('Installed')
    expect(runs).toEqual([['plugin', 'install', 'eliasstravik/herdr-projects', '--ref', `v${PROJECTS_TESTED}`, '--yes']])
  })

  it('never takes a program back, nor runs where its version is unknown or wherdr does not read it', async () => {
    for (const [listed, program] of [['1.2.1', PROJECTS_TESTED], ['1.2.1', '1.3.0'], ['1.2.1', null], ['0.2.34', '0.2.34']] as const) {
      plugins.list = [manifest(listed)]
      const { m, runs } = machine()
      await expect(updateProjectsPlugin(m, program)).rejects.toMatchObject({ code: 'up_to_date' })
      expect(runs).toEqual([])
    }
  })

  it('Install stays for a machine without herdr-projects, with the same release', async () => {
    const { m, runs } = machine()
    await installProjectsPlugin(m)
    expect(runs[0]).toContain(`v${PROJECTS_TESTED}`)
    plugins.list = [manifest('1.2.1')]
    await expect(installProjectsPlugin(machine().m)).rejects.toMatchObject({ code: 'already_installed' })
  })
})
