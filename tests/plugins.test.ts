import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { REMOTE_PROJECTS_SCRIPT, actionContext, logResult, needsConfirm, normalizeActions, outputTail, shortLabel } from '../server/utils/pluginPolicy'

// Real Herdr 0.9.1 responses (plugin.action.list / plugin.list), including the
// actions of the herdr-projects plugin.
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
  it('targets the space shown, even if Herdr is focused elsewhere, on each machine', () => {
    const pane = { id: 'abcd1234~w2:p1', tab: 'abcd1234~w2:t1', workspace: 'abcd1234~w2', cwd: '/tmp/project-b' }
    const spaces = [{ id: 'w1', label: 'Autre space' }, { id: 'abcd1234~w2', label: 'Nouveau space' }]
    expect(actionContext(pane as never, spaces as never)).toMatchObject({
      focused_pane_id: 'w2:p1', tab_id: 'w2:t1', workspace_id: 'w2',
      workspace_label: 'Nouveau space', workspace_cwd: '/tmp/project-b', focused_pane_cwd: '/tmp/project-b',
    })
  })
  it('splits actions between the agent\'s menu and the machine\'s', () => {
    const list = normalizeActions(ACTIONS, PLUGINS)
    const pick = (id: string) => list.find(a => a.id === id)!
    expect(pick('hello')).toMatchObject({ agent: true, machine: false, pluginName: 'Wherdr Test', description: 'Affiche le contexte reçu' })
    expect(pick('status')).toMatchObject({ agent: false, machine: true })
    // No declared context: global action.
    expect(pick('nocontext')).toMatchObject({ agent: false, machine: true })
    // Global and workspace: in both menus.
    expect(pick('open-popup')).toMatchObject({ agent: true, machine: true })
    // Needs a text selection: dropped.
    expect(list.find(a => a.id === 'copy')).toBeUndefined()
  })

  it('groups by plugin, labels in alphabetical order', () => {
    const list = normalizeActions(ACTIONS, PLUGINS)
    expect(list.map(a => `${a.pluginName}/${a.label}`)).toEqual([
      'Projects/Check setup', 'Projects/Pause project', 'Projects/Projects',
      'Projects/Set up the sidebar, popup key, progress hooks and skill',
      'Wherdr Test/No context declared', 'Wherdr Test/Say hello', 'Wherdr Test/Show status',
    ])
  })

  it('shortens labels under the plugin header', () => {
    expect(shortLabel('Projects: pause project', 'Projects')).toBe('Pause project')
    expect(shortLabel('Projects', 'Projects')).toBe('Projects')
    expect(shortLabel('Say hello', 'Wherdr Test')).toBe('Say hello')
    expect(shortLabel('Layout — apply', 'layout')).toBe('Apply')
    expect(normalizeActions(ACTIONS, PLUGINS).find(a => a.id === 'doctor')).toMatchObject({ title: 'Projects: check setup', label: 'Check setup' })
  })

  it('drops disabled plugins and dubious identifiers', () => {
    const list = normalizeActions([
      ...ACTIONS,
      { plugin_id: 'x; rm -rf ~', action_id: 'a', title: 'bad' },
      { plugin_id: 'ok', action_id: 'a.b', title: 'point interdit dans un id d’action' },
    ], [...PLUGINS.slice(0, 1), { plugin_id: 'herdr-projects', name: 'Projects', enabled: false }])
    expect(list.every(a => a.plugin === 'wherdr.test')).toBe(true)
  })

  it('asks for confirmation except for what only shows or checks', () => {
    const list = normalizeActions(ACTIONS, PLUGINS)
    const confirm = Object.fromEntries(list.map(a => [a.id, a.confirm]))
    expect(confirm).toMatchObject({ 'doctor': false, 'status': false, 'pause': true, 'configure': true, 'open-popup': true, 'hello': true })
    expect(needsConfirm({ id: 'list-workspaces', title: 'List workspaces' })).toBe(false)
    expect(needsConfirm({ id: 'deploy', title: 'Déployer la prod' })).toBe(true)
    expect(needsConfirm({ id: 'x', title: 'Afficher l’état' })).toBe(false)
  })

  it('hides wherdr\'s own plugin and flags actions that open in Herdr', () => {
    const list = normalizeActions([
      ...ACTIONS,
      { plugin_id: 'someone.wherdr', action_id: 'panel', title: 'wherdr', contexts: ['global'], command: ['sh', '-c', 'exec "${HERDR_BIN_PATH:-herdr}" plugin pane open --plugin "$HERDR_PLUGIN_ID" --entrypoint panel'] },
      { plugin_id: 'wherdr', action_id: 'open', title: 'wherdr: open in the browser', contexts: ['global'] },
      { plugin_id: 'wherdr.test', action_id: 'board', title: 'Board', contexts: ['global'], command: ['herdr', 'plugin', 'pane', 'open', '--entrypoint', 'board'] },
      { plugin_id: 'wherdr.test', action_id: 'float', title: 'Float', contexts: ['global'], placement: 'overlay' },
    ], PLUGINS)
    expect(list.some(a => a.plugin.endsWith('wherdr'))).toBe(false)
    const inHerdr = Object.fromEntries(list.map(a => [a.id, a.inHerdr]))
    expect(inHerdr).toMatchObject({ 'board': true, 'float': true, 'open-popup': true, 'doctor': false, 'pause': false, 'hello': false })
  })

  it('summarizes the output for a toast', () => {
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

describe('REMOTE_PROJECTS_SCRIPT', () => {
  it('exporte HERDR_BIN_PATH vers le binaire du plugin et garde ses arguments', () => {
    // `sh -c 'echo …'` plays the plugin binary: it only sees the exported environment.
    const out = execFileSync('sh', ['-c', REMOTE_PROJECTS_SCRIPT, 'sh', '/opt/herdr', 'sh', '-c', 'printf "%s|%s" "$HERDR_BIN_PATH" "$1"', 'x', 'a b'], { encoding: 'utf8', env: { PATH: process.env.PATH } })
    expect(out).toBe('/opt/herdr|a b')
  })
})
