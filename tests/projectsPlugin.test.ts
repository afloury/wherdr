import { describe, expect, it } from 'vitest'
import { projectsPluginFromList } from '../server/utils/projectsPlugin'
import { pluginBinary } from '../server/utils/projectBoard'
import { PROJECTS_COMMAND, PROJECTS_INSTALL_ARGS, PROJECTS_REINSTALL_COMMAND, isUnsupportedProjects, manifestBinary, updatesToUnsupported } from '../shared/projectsPlugin'

// Manifests as Herdr's plugin.list reports them.
const v02 = {
  plugin_id: 'herdr-projects', enabled: true, version: '0.2.34', plugin_root: '/home/user/.config/herdr/plugins/github/herdr-projects-0123',
  startup: [{ command: ['target/release/herdr-projects', 'startup'] }],
  actions: [{ command: ['target/release/herdr-projects', 'action', 'new'] }],
  source: { kind: 'github', owner: 'afloury', repo: 'herdr-projects' },
}
const v1 = {
  plugin_id: 'herdr-projects', enabled: true, version: '1.2.1', plugin_root: '/home/user/.config/herdr/plugins/github/herdr-projects-4567',
  startup: [{ command: ['sh', 'bin/run.sh', 'hook'] }],
  actions: [{ command: ['sh', 'bin/run.sh', 'open'] }],
  source: { kind: 'github', owner: 'eliasstravik', repo: 'herdr-projects' },
}

describe('herdr-projects in Settings', () => {
  it('detects the plugin by its identifier without confusing another plugin', () => {
    expect(projectsPluginFromList([{ plugin_id: 'other', version: '1.0' }])).toEqual({ installed: false, enabled: false, version: null, unsupported: false, upstream: false })
    expect(projectsPluginFromList([{ plugin_id: 'herdr-projects', version: '0.2.25', enabled: true }])).toEqual({ installed: true, enabled: true, version: '0.2.25', unsupported: false, upstream: false })
  })
  it('tells an installed but disabled plugin apart and rejects an unexpected version', () => {
    expect(projectsPluginFromList([{ plugin_id: 'herdr-projects', enabled: false, version: '<script>' }])).toMatchObject({ installed: true, enabled: false, version: null })
  })
  it('installs the 0.2 line from the fork, never upstream (whose newest release is 1.x)', () => {
    expect(PROJECTS_COMMAND).toBe('herdr plugin install afloury/herdr-projects --yes')
    expect(PROJECTS_INSTALL_ARGS).toEqual(['plugin', 'install', 'afloury/herdr-projects', '--yes'])
    expect(PROJECTS_REINSTALL_COMMAND).toBe('herdr plugin uninstall herdr-projects && herdr plugin install afloury/herdr-projects --yes')
  })
})

describe('herdr-projects 1.x', () => {
  it('is flagged as unsupported, with its version', () => {
    expect(projectsPluginFromList([v1])).toEqual({ installed: true, enabled: true, version: '1.2.1', unsupported: true, upstream: false })
    expect(projectsPluginFromList([v02])).toMatchObject({ unsupported: false, upstream: false })
  })
  it('is recognized by its manifest when the version is missing or unreadable', () => {
    expect(isUnsupportedProjects({ ...v1, version: undefined })).toBe(true)
    expect(isUnsupportedProjects({ ...v1, version: 'next' })).toBe(true)
    expect(isUnsupportedProjects({ ...v02, version: undefined })).toBe(false)
    // Nothing to judge by: not flagged.
    expect(isUnsupportedProjects({ plugin_id: 'herdr-projects' })).toBe(false)
  })
  it('a later major version stays unsupported', () => {
    expect(isUnsupportedProjects({ ...v02, version: '2.0.0' })).toBe(true)
    expect(isUnsupportedProjects({ ...v02, version: '0.10.0' })).toBe(false)
  })
  it('has no herdr-projects binary, so the Project panel stays off', () => {
    expect(manifestBinary(v1)).toBeNull()
    expect(pluginBinary([v1])).toBeNull()
    expect(manifestBinary(v02)).toBe('target/release/herdr-projects')
    expect(pluginBinary([v02])).toBe(`${v02.plugin_root}/target/release/herdr-projects`)
  })
  it('ignores a binary path that climbs out of the plugin folder', () => {
    expect(manifestBinary({ actions: [{ command: ['../../bin/herdr-projects'] }] })).toBeNull()
  })
})

describe('0.2 installed from upstream', () => {
  const upstream02 = { ...v02, source: { kind: 'github', owner: 'eliasstravik', repo: 'herdr-projects' } }
  it('is flagged: its own update would install 1.x', () => {
    expect(updatesToUnsupported(upstream02)).toBe(true)
    expect(projectsPluginFromList([upstream02])).toMatchObject({ unsupported: false, upstream: true })
  })
  it('the fork, a linked checkout or 1.x itself are not', () => {
    expect(updatesToUnsupported(v02)).toBe(false)
    expect(updatesToUnsupported({ ...upstream02, source: { kind: 'link' } })).toBe(false)
    expect(updatesToUnsupported(v1)).toBe(false)
  })
})
