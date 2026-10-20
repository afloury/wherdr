import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectsPluginFromList } from '../server/utils/projectsPlugin'
import {
  NATIVE_MOVE_ANCHOR, PROJECTS_COMMAND, PROJECTS_INSTALL_ARGS, PROJECTS_LAUNCHER, PROJECTS_MIGRATION_GUIDE, PROJECTS_UPGRADE_COMMAND, WHERDR_DOWNGRADE_COMMANDS,
  projectsLauncher, projectsStatus, versionAtLeast,
} from '../shared/projectsPlugin'

// Manifests as Herdr's plugin.list reports them.
const v02 = {
  plugin_id: 'herdr-projects', enabled: true, version: '0.2.34', plugin_root: '/home/user/.config/herdr/plugins/github/herdr-projects-0123',
  startup: [{ command: ['target/release/herdr-projects', 'startup'] }],
  actions: [{ command: ['target/release/herdr-projects', 'action', 'new'] }],
  source: { kind: 'github', owner: 'someone', repo: 'herdr-projects' },
}
const v1 = {
  plugin_id: 'herdr-projects', enabled: true, version: '1.2.1', plugin_root: '/home/user/.config/herdr/plugins/github/herdr-projects-4567',
  startup: [{ command: ['sh', 'bin/run.sh', 'hook'] }],
  actions: [{ command: ['sh', 'bin/run.sh', 'open'] }],
  source: { kind: 'github', owner: 'eliasstravik', repo: 'herdr-projects' },
}

describe('which herdr-projects wherdr reads', () => {
  it('reads 1.2.1 and later', () => {
    expect(projectsStatus(v1)).toBe('ready')
    expect(projectsStatus({ ...v1, version: '1.3.0' })).toBe('ready')
    expect(projectsStatus({ ...v1, version: '2.0.0' })).toBe('ready')
  })

  it('asks for an update on a 0.2, an older 1.x, or a manifest without its launcher', () => {
    expect(projectsStatus(v02)).toBe('old')
    expect(projectsStatus({ ...v1, version: '1.2.0' })).toBe('old')
    expect(projectsStatus({ ...v1, version: '1.0.0' })).toBe('old')
    expect(projectsStatus({ ...v1, version: undefined })).toBe('old')
    expect(projectsStatus({ ...v1, version: 'next' })).toBe('old')
    expect(projectsStatus({ ...v1, actions: [], startup: [] })).toBe('old')
  })

  it('missing, and disabled', () => {
    expect(projectsStatus(null)).toBe('missing')
    expect(projectsStatus({ ...v1, enabled: false })).toBe('disabled')
  })

  it('finds the launcher the manifest runs, and only under an absolute plugin folder', () => {
    expect(projectsLauncher(v1)).toBe('/home/user/.config/herdr/plugins/github/herdr-projects-4567/bin/run.sh')
    expect(projectsLauncher(v02)).toBeNull()
    expect(projectsLauncher({ ...v1, plugin_root: 'relative' })).toBeNull()
    expect(projectsLauncher({ ...v1, plugin_root: '/a/../b' })).toBeNull()
  })

  it('compares versions part by part', () => {
    expect(versionAtLeast('1.10.0', '1.2.1')).toBe(true)
    expect(versionAtLeast('1.2.1', '1.2.1')).toBe(true)
    expect(versionAtLeast('v1.2.1', '1.2.1')).toBe(true)
    expect(versionAtLeast('1.2.1-rc.1', '1.2.1')).toBe(true)
    expect(versionAtLeast('1.2', '1.2.1')).toBe(false)
    expect(versionAtLeast('0.9.9', '1.2.1')).toBe(false)
    expect(versionAtLeast(null, '1.2.1')).toBe(false)
  })
})

describe('herdr-projects in Settings', () => {
  it('detects the plugin by its identifier without confusing another plugin', () => {
    expect(projectsPluginFromList([{ plugin_id: 'other', version: '1.0' }])).toEqual({ status: 'missing', version: null })
    expect(projectsPluginFromList([v1])).toEqual({ status: 'ready', version: '1.2.1' })
    expect(projectsPluginFromList([v02])).toEqual({ status: 'old', version: '0.2.34' })
  })

  it('rejects an unexpected version string', () => {
    expect(projectsPluginFromList([{ ...v1, version: '<script>' }])).toEqual({ status: 'old', version: null })
  })

  it('installs 1.2.1 from upstream, replaces an older copy, and names the way back', () => {
    expect(PROJECTS_COMMAND).toBe('herdr plugin install eliasstravik/herdr-projects --ref v1.2.1 --yes')
    expect(PROJECTS_INSTALL_ARGS).toEqual(['plugin', 'install', 'eliasstravik/herdr-projects', '--ref', 'v1.2.1', '--yes'])
    expect(PROJECTS_UPGRADE_COMMAND).toBe('herdr plugin uninstall herdr-projects && herdr plugin install eliasstravik/herdr-projects --ref v1.2.1 --yes')
    expect(WHERDR_DOWNGRADE_COMMANDS).toContain('npm install -g wherdr@1.3.4')
  })
})

describe('the migration guide the note names', () => {
  it('is in the repository and in the npm package', () => {
    const root = path.resolve(import.meta.dirname, '..')
    expect(existsSync(path.join(root, PROJECTS_MIGRATION_GUIDE))).toBe(true)
    expect(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).files).toContain(PROJECTS_MIGRATION_GUIDE)
  })
  it('has the move from Docker the Board of a container links to, and the README points to it', async () => {
    const root = path.resolve(import.meta.dirname, '..')
    const guide = readFileSync(path.join(root, PROJECTS_MIGRATION_GUIDE), 'utf8')
    // GitHub's anchor of "## Moving from Docker to the native service".
    expect(guide).toMatch(/^## Moving from Docker to the native service$/m)
    expect(NATIVE_MOVE_ANCHOR).toBe('moving-from-docker-to-the-native-service')
    const { NATIVE_MOVE_URL, REPO } = await import('../server/utils/updates')
    expect(NATIVE_MOVE_URL).toBe(`https://github.com/${REPO}/blob/main/${PROJECTS_MIGRATION_GUIDE}#${NATIVE_MOVE_ANCHOR}`)
    // Backup, container removed, same data folder, the installer, and the way back.
    for (const step of ['tar czf', 'docker compose down', '~/wherdr/data', 'curl -fsSL https://wherdr.dev/install | sh', '### Going back to Docker', 'docker compose up -d']) expect(guide).toContain(step)
    const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
    expect(readme).toContain(`${PROJECTS_MIGRATION_GUIDE}#${NATIVE_MOVE_ANCHOR}`)
    const installer = readFileSync(path.join(root, 'website/public/install'), 'utf8')
    expect(installer).toContain(`docs/herdr-projects-1x.md#${NATIVE_MOVE_ANCHOR}`)
  })
})

describe('commands for the host', () => {
  it('name the launcher herdr-projects 1.x writes, since nothing is on the PATH', () => {
    expect(PROJECTS_LAUNCHER).toBe('~/.herdr-projects/data/bin/herdr-projects')
  })
})
