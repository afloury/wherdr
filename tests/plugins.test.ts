import { describe, expect, it } from 'vitest'
import { logResult, needsConfirm, normalizeActions, outputTail, shortLabel } from '../server/utils/pluginPolicy'

// Réponses réelles de Herdr 0.9.1 (plugin.action.list / plugin.list), dont les
// actions du plugin herdr-projects.
const hp = (id: string, title: string, contexts: string[]) => ({ plugin_id: 'herdr-projects', action_id: id, title, contexts, command: ['x'] })
const ACTIONS = [
  { plugin_id: 'wherdr.test', action_id: 'hello', title: 'Say hello', description: 'Affiche le contexte reçu', contexts: ['workspace', 'pane'] },
  { plugin_id: 'wherdr.test', action_id: 'nocontext', title: 'No context declared' },
  { plugin_id: 'wherdr.test', action_id: 'status', title: 'Show status', contexts: ['global'] },
  { plugin_id: 'wherdr.test', action_id: 'copy', title: 'Copy selection', contexts: ['selection'] },
  hp('open-popup', 'Projects', ['global', 'workspace']),
  hp('pause', 'Projects: pause project', ['workspace']),
  hp('doctor', 'Projects: check setup', ['workspace']),
  hp('configure', 'Projects: set up the sidebar, popup key, progress hooks and skill', ['workspace']),
]
const PLUGINS = [
  { plugin_id: 'wherdr.test', name: 'Wherdr Test', enabled: true },
  { plugin_id: 'herdr-projects', name: 'Projects', enabled: true },
]

describe('actions des plugins', () => {
  it('répartit les actions entre le menu de l’agent et celui de la machine', () => {
    const list = normalizeActions(ACTIONS, PLUGINS)
    const pick = (id: string) => list.find(a => a.id === id)!
    expect(pick('hello')).toMatchObject({ agent: true, machine: false, pluginName: 'Wherdr Test', description: 'Affiche le contexte reçu' })
    expect(pick('status')).toMatchObject({ agent: false, machine: true })
    // Aucun contexte déclaré : action globale.
    expect(pick('nocontext')).toMatchObject({ agent: false, machine: true })
    // Global et workspace : dans les deux menus.
    expect(pick('open-popup')).toMatchObject({ agent: true, machine: true })
    // Il faut une sélection de texte : écartée.
    expect(list.find(a => a.id === 'copy')).toBeUndefined()
  })

  it('groupe par plugin, libellés par ordre alphabétique', () => {
    const list = normalizeActions(ACTIONS, PLUGINS)
    expect(list.map(a => `${a.pluginName}/${a.label}`)).toEqual([
      'Projects/Check setup', 'Projects/Pause project', 'Projects/Projects',
      'Projects/Set up the sidebar, popup key, progress hooks and skill',
      'Wherdr Test/No context declared', 'Wherdr Test/Say hello', 'Wherdr Test/Show status',
    ])
  })

  it('raccourcit les libellés sous l’en-tête du plugin', () => {
    expect(shortLabel('Projects: pause project', 'Projects')).toBe('Pause project')
    expect(shortLabel('Projects', 'Projects')).toBe('Projects')
    expect(shortLabel('Say hello', 'Wherdr Test')).toBe('Say hello')
    expect(shortLabel('Layout — apply', 'layout')).toBe('Apply')
    expect(normalizeActions(ACTIONS, PLUGINS).find(a => a.id === 'doctor')).toMatchObject({ title: 'Projects: check setup', label: 'Check setup' })
  })

  it('écarte les plugins désactivés et les identifiants douteux', () => {
    const list = normalizeActions([
      ...ACTIONS,
      { plugin_id: 'x; rm -rf ~', action_id: 'a', title: 'bad' },
      { plugin_id: 'ok', action_id: 'a.b', title: 'point interdit dans un id d’action' },
    ], [...PLUGINS.slice(0, 1), { plugin_id: 'herdr-projects', name: 'Projects', enabled: false }])
    expect(list.every(a => a.plugin === 'wherdr.test')).toBe(true)
  })

  it('demande confirmation sauf pour ce qui ne fait que montrer ou vérifier', () => {
    const list = normalizeActions(ACTIONS, PLUGINS)
    const confirm = Object.fromEntries(list.map(a => [a.id, a.confirm]))
    expect(confirm).toMatchObject({ 'doctor': false, 'status': false, 'pause': true, 'configure': true, 'open-popup': true, 'hello': true })
    expect(needsConfirm({ id: 'list-workspaces', title: 'List workspaces' })).toBe(false)
    expect(needsConfirm({ id: 'deploy', title: 'Déployer la prod' })).toBe(true)
    expect(needsConfirm({ id: 'x', title: 'Afficher l’état' })).toBe(false)
  })

  it('résume la sortie pour un toast', () => {
    expect(outputTail('\x1b[32mok\x1b[0m\n\nfini\n')).toBe('ok\nfini')
    expect(outputTail('a'.repeat(500), 20)).toBe('…' + 'a'.repeat(19))
    expect(outputTail(['l1', 'l2', 'l3'].join('\n'), 5)).toBe('l2\nl3')
    expect(logResult({ status: 'succeeded', exit_code: 0, stdout: 'pane=w1:p1\n', stderr: '' }))
      .toEqual({ status: 'succeeded', exitCode: 0, output: 'pane=w1:p1' })
    expect(logResult({ status: 'failed', exit_code: 3, stdout: 'nocontext\n', stderr: 'boom\n' }))
      .toEqual({ status: 'failed', exitCode: 3, output: 'boom' })
    expect(logResult({ status: 'running' })).toEqual({ status: 'running', exitCode: null, output: '' })
    expect(logResult(null).status).toBe('running')
  })
})
