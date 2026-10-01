import { describe, expect, it } from 'vitest'
import { projectsPluginFromList } from '../server/utils/projectsPlugin'
import { PROJECTS_COMMAND, PROJECTS_INSTALL_ARGS } from '../shared/projectsPlugin'

describe('herdr-projects in Settings', () => {
  it('detects the plugin by its identifier without confusing another plugin', () => {
    expect(projectsPluginFromList([{ plugin_id: 'other', version: '1.0' }])).toEqual({ installed: false, enabled: false, version: null })
    expect(projectsPluginFromList([{ plugin_id: 'herdr-projects', version: '0.2.25', enabled: true }])).toEqual({ installed: true, enabled: true, version: '0.2.25' })
  })
  it('tells an installed but disabled plugin apart and rejects an unexpected version', () => {
    expect(projectsPluginFromList([{ plugin_id: 'herdr-projects', enabled: false, version: '<script>' }])).toEqual({ installed: true, enabled: false, version: null })
  })
  it('uses the official command with the CLI\'s non-interactive confirmation', () => {
    expect(PROJECTS_COMMAND).toBe('herdr plugin install eliasstravik/herdr-projects --yes')
    expect(PROJECTS_INSTALL_ARGS).toEqual(['plugin', 'install', 'eliasstravik/herdr-projects', '--yes'])
  })
})
