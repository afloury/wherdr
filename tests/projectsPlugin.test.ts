import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectsPluginFromList } from '../server/utils/projectsPlugin'
import {
  PROJECTS_COMMAND, PROJECTS_INSTALL_ARGS, PROJECTS_LAUNCHER, PROJECTS_MIGRATION_GUIDE, PROJECTS_MIN, PROJECTS_TESTED, PROJECTS_UPGRADE_COMMAND, WHERDR_DOWNGRADE_COMMANDS,
  parseProjectsVersion, projectsBehind, projectsLauncher, projectsStatus, versionAtLeast,
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

  it('installs the tested release from upstream, replaces an older copy, and names the way back', () => {
    expect(PROJECTS_COMMAND).toBe('herdr plugin install eliasstravik/herdr-projects --ref v1.2.21 --yes')
    expect(PROJECTS_INSTALL_ARGS).toEqual(['plugin', 'install', 'eliasstravik/herdr-projects', '--ref', 'v1.2.21', '--yes'])
    expect(PROJECTS_UPGRADE_COMMAND).toBe('herdr plugin uninstall herdr-projects && herdr plugin install eliasstravik/herdr-projects --ref v1.2.21 --yes')
    expect(WHERDR_DOWNGRADE_COMMANDS).toContain('npm install -g wherdr@1.3.4')
  })

  it('installs the release its commands were recorded with, and still reads from 1.2.1', () => {
    expect(PROJECTS_MIN).toBe('1.2.1')
    expect(versionAtLeast(PROJECTS_TESTED, '1.2.21')).toBe(true)
    expect(PROJECTS_INSTALL_ARGS).toContain(`v${PROJECTS_TESTED}`)
    const recordings = path.resolve(import.meta.dirname, 'recordings', `herdr-projects-${PROJECTS_TESTED}`)
    expect(parseProjectsVersion(readFileSync(path.join(recordings, 'version.txt'), 'utf8'))).toBe(PROJECTS_TESTED)
  })

  it('the docs give the same install command', () => {
    const root = path.resolve(import.meta.dirname, '..')
    for (const doc of ['docs/board.md', PROJECTS_MIGRATION_GUIDE, 'website/public/agent.md']) {
      const text = readFileSync(path.join(root, doc), 'utf8')
      expect(text, doc).toContain(`--ref v${PROJECTS_TESTED} --yes`)
      expect(text, doc).not.toMatch(/--ref v(?!\d+\.\d+\.\d+ --yes)|--ref v1\.2\.1 /)
    }
  })
})

describe('an update to the tested release', () => {
  it('reads the program\'s own version', () => {
    expect(parseProjectsVersion('herdr-projects 1.2.16 (/home/user/.config/herdr/plugins/x/bin/herdr-projects-linux-x86_64)\n')).toBe('1.2.16')
    expect(parseProjectsVersion('herdr-projects 1.2.21')).toBe('1.2.21')
    expect(parseProjectsVersion('unexpected: version')).toBeNull()
    expect(parseProjectsVersion('herdr-projects <script>')).toBeNull()
    expect(parseProjectsVersion('')).toBeNull()
  })

  it('is offered from 1.2.1 up to the release before the tested one', () => {
    expect(projectsBehind('1.2.1')).toBe(true)
    expect(projectsBehind('1.2.16')).toBe(true)
    expect(projectsBehind('1.2.20')).toBe(true)
  })

  it('is not offered on the tested release or a newer one, on one wherdr does not read, or on an unknown version', () => {
    expect(projectsBehind(PROJECTS_TESTED)).toBe(false)
    expect(projectsBehind('1.2.22')).toBe(false)
    expect(projectsBehind('1.10.0')).toBe(false)
    expect(projectsBehind('1.2.0')).toBe(false)
    expect(projectsBehind('0.2.34')).toBe(false)
    expect(projectsBehind(null)).toBe(false)
    expect(projectsBehind('next')).toBe(false)
  })
})

describe('the migration guide the note names', () => {
  it('is in the repository and in the npm package', () => {
    const root = path.resolve(import.meta.dirname, '..')
    expect(existsSync(path.join(root, PROJECTS_MIGRATION_GUIDE))).toBe(true)
    expect(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).files).toContain('docs/*.md')
  })
  it('keeps a migration for existing 1.x image installs', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const guide = readFileSync(path.join(root, PROJECTS_MIGRATION_GUIDE), 'utf8')
    expect(guide).toContain('Published 1.x images')
    expect(guide).toContain('](migrate-from-1.x-docker.md)')
    const docker = readFileSync(path.join(root, 'docs/migrate-from-1.x-docker.md'), 'utf8')
    for (const step of ['Back up', 'docker compose down', '~/wherdr/data', 'curl -fsSL https://wherdr.dev/install |']) expect(docker).toContain(step)
    expect(readFileSync(path.join(root, 'docs/installation.md'), 'utf8')).toContain('](migrate-from-1.x-docker.md)')
  })
})
