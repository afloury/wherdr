import { describe, expect, it } from 'vitest'
import { projectsPluginFromList } from '../server/utils/projectsPlugin'
import { PROJECTS_COMMAND, PROJECTS_INSTALL_ARGS } from '../shared/projectsPlugin'

describe('herdr-projects dans Réglages', () => {
  it('détecte le plugin par son identifiant sans confondre un autre plugin', () => {
    expect(projectsPluginFromList([{ plugin_id: 'other', version: '1.0' }])).toEqual({ installed: false, enabled: false, version: null })
    expect(projectsPluginFromList([{ plugin_id: 'herdr-projects', version: '0.2.25', enabled: true }])).toEqual({ installed: true, enabled: true, version: '0.2.25' })
  })
  it('distingue un plugin installé mais désactivé et rejette une version inattendue', () => {
    expect(projectsPluginFromList([{ plugin_id: 'herdr-projects', enabled: false, version: '<script>' }])).toEqual({ installed: true, enabled: false, version: null })
  })
  it('utilise la commande officielle avec confirmation non interactive du CLI', () => {
    expect(PROJECTS_COMMAND).toBe('herdr plugin install eliasstravik/herdr-projects --yes')
    expect(PROJECTS_INSTALL_ARGS).toEqual(['plugin', 'install', 'eliasstravik/herdr-projects', '--yes'])
  })
})
