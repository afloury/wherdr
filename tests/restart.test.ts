import { describe, expect, it } from 'vitest'
import { claudeFooterMode, launchOptions, planRestart, restartNotice } from '../shared/restart'
import { type RestartDeps, startAgent, stopAgent } from '../server/utils/restartSeq'

const ID = '00000000-0000-4000-8000-000000000001'

describe('options de lancement', () => {
  it('garde les options connues de Claude, écarte le choix de conversation et le message initial', () => {
    const r = launchOptions('claude', ['claude', '--model', 'sonnet', '--resume', 'abc', '--permission-mode', 'plan', '--dangerously-skip-permissions', '--tmux', 'bonjour'])
    // --tmux : propre au premier lancement, signalé ; --resume : remplacé, sans bruit.
    expect(r.kept.flat()).toEqual(['--model', 'sonnet', '--permission-mode', 'plan', '--dangerously-skip-permissions'])
    expect(r.dropped.flat()).toEqual(['--tmux'])
  })
  it('options à valeurs multiples et forme --option=valeur', () => {
    const r = launchOptions('claude', ['/usr/bin/claude', '--add-dir', '/a', '/b', '--effort=high', '-c'])
    expect(r.kept.flat()).toEqual(['--add-dir', '/a', '/b', '--effort=high'])
    expect(r.dropped.flat()).toEqual([])
  })
  it('option inconnue écartée avec sa valeur', () => {
    const r = launchOptions('claude', ['claude', '--mystere', 'x', '--verbose'])
    expect(r.kept.flat()).toEqual(['--verbose'])
    expect(r.dropped.flat()).toEqual(['--mystere', 'x'])
  })
  it('Codex lancé par node, sous-commande resume ignorée', () => {
    const r = launchOptions('codex', ['node', '/opt/lib/codex.js', 'resume', '--last', '-m', 'gpt-x', '-s', 'workspace-write', '--yolo'])
    expect(r.kept.flat()).toEqual(['-m', 'gpt-x', '-s', 'workspace-write', '--yolo'])
    expect(r.dropped.flat()).toEqual([])
  })
})

describe('commande de relance', () => {
  it('Claude : reprend la conversation par son id, sans le modèle d’origine (restauré par --resume)', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude', '--model', 'haiku', '--effort', 'low'], session: ID, hadSession: true })
    expect(p.mode).toBe('resume')
    expect(p.args).toEqual(['--effort', 'low', '--resume', ID])
  })
  it('Claude : effort et mode de permission lus à l’écran remplacent ceux d’origine', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude', '--effort', 'low', '--permission-mode', 'plan'], session: ID, hadSession: true, current: { effort: 'High', permissionMode: 'acceptEdits' } })
    expect(p.args).toEqual(['--effort', 'high', '--permission-mode', 'acceptEdits', '--resume', ID])
  })
  it('Claude : mode par défaut à l’écran retire le mode d’origine ; effort inconnu ignoré', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude', '--permission-mode', 'plan'], session: ID, hadSession: true, current: { effort: 'turbo', permissionMode: 'default' } })
    expect(p.args).toEqual(['--resume', ID])
  })
  it('Claude sans id de session : --continue, avec les options d’origine', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude', '--model', 'haiku'], session: null, hadSession: false })
    expect(p).toMatchObject({ mode: 'continue', args: ['--model', 'haiku', '--continue'] })
  })
  it('conversation vide (id sans transcription) : relance neuve, rien à reprendre', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude'], session: null, hadSession: true })
    expect(p).toMatchObject({ mode: 'fresh', args: [] })
  })
  it('Codex : resume <id>, sinon resume --last', () => {
    expect(planRestart({ kind: 'codex', argv: ['codex', '-m', 'gpt-x'], session: ID, hadSession: true }).args).toEqual(['resume', '-m', 'gpt-x', ID])
    expect(planRestart({ kind: 'codex', argv: ['codex'], session: null, hadSession: false }).args).toEqual(['resume', '--last'])
  })
  it('ligne de commande introuvable : signalée', () => {
    expect(planRestart({ kind: 'claude', argv: null, session: ID, hadSession: true }).unknownArgs).toBe(true)
  })
})

describe('confirmation', () => {
  const quiet = { mode: 'resume' as const, kept: [], dropped: [], unknownArgs: false }
  it('agent au repos, tout retrouvé : pas de modale', () => {
    expect(restartNotice('idle', quiet).confirm).toBe(false)
    expect(restartNotice('done', quiet).confirm).toBe(false)
  })
  it('agent au travail ou en attente : avertissement', () => {
    expect(restartNotice('working', quiet)).toMatchObject({ confirm: true, busy: true })
    expect(restartNotice('blocked', quiet)).toMatchObject({ confirm: true, busy: true })
  })
  it('options perdues ou conversation vide : modale même au repos', () => {
    expect(restartNotice('idle', { ...quiet, unknownArgs: true })).toMatchObject({ confirm: true, defaults: true })
    expect(restartNotice('idle', { ...quiet, dropped: ['--mystere'] }).confirm).toBe(true)
    expect(restartNotice('idle', { ...quiet, mode: 'fresh' }).confirm).toBe(true)
  })
})

describe('mode de permission à l’écran', () => {
  const screen = (footer: string) => ['● Réponse', '', '─'.repeat(40), '❯ ', '─'.repeat(40), footer].join('\n')
  it('lit le mode sous le champ', () => {
    expect(claudeFooterMode(screen('  ⏸ plan mode on (shift+tab to cycle)'))).toBe('plan')
    expect(claudeFooterMode(screen('  ⏵⏵ accept edits on (shift+tab to cycle)'))).toBe('acceptEdits')
    expect(claudeFooterMode(screen('  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'))).toBe('auto')
    expect(claudeFooterMode(screen('  ? for shortcuts'))).toBe('default')
  })
  it('champ absent (dialogue, menu) : inconnu', () => {
    expect(claudeFooterMode('Do you want to proceed?\n❯ 1. Yes\n  2. No')).toBeNull()
    expect(claudeFooterMode(null)).toBeNull()
  })
})

// Faux Herdr : le pane repasse au shell après `trigger` (touche ou texte).
function fakeHerdr(o: { exitOn: string | null, status?: string }) {
  const calls: string[] = []
  let atShell = false
  let status = o.status || 'idle'
  let t = 0
  const d: RestartDeps = {
    now: () => t,
    sleep: async (ms) => { t += ms },
    call: async (method, params) => {
      if (method === 'pane.send_input') {
        const what = params.text ? `text:${params.text}` : `keys:${(params.keys as string[]).join(',')}`
        calls.push(what)
        if (what === 'keys:esc') status = 'idle'
        if (o.exitOn && what === o.exitOn) atShell = true
        return {}
      }
      if (method === 'pane.get') return { pane: { agent_status: status } }
      if (method === 'pane.process_info') {
        return { process_info: { shell_pid: 10, foreground_process_group_id: atShell ? 10 : 20, foreground_processes: atShell ? [] : [{ pid: 20, name: 'claude', argv: ['claude'] }] } }
      }
      if (method === 'agent.start') { calls.push(`start:${JSON.stringify(params.args || [])}`); return {} }
      throw new Error(method)
    },
  }
  return { d, calls }
}

describe('séquence d’arrêt et de relance', () => {
  it('au repos : /exit puis Entrée suffit', async () => {
    const { d, calls } = fakeHerdr({ exitOn: 'keys:enter' })
    expect(await stopAgent(d, { id: 'w1:p1', agent: 'claude', status: 'idle' })).toBe('exit')
    expect(calls).toEqual(['text:/exit', 'keys:enter'])
  })
  it('au travail : un seul Échap (l’agent s’arrête), puis /exit', async () => {
    const { d, calls } = fakeHerdr({ exitOn: 'keys:enter', status: 'working' })
    await stopAgent(d, { id: 'w1:p1', agent: 'claude', status: 'working' })
    expect(calls).toEqual(['keys:esc', 'text:/exit', 'keys:enter'])
  })
  it('/exit sans effet : Ctrl+C deux fois', async () => {
    const { d, calls } = fakeHerdr({ exitOn: 'keys:ctrl+c' })
    expect(await stopAgent(d, { id: 'w1:p1', agent: 'claude', status: 'idle' })).toBe('ctrl-c')
    expect(calls).toEqual(['text:/exit', 'keys:enter', 'keys:ctrl+c', 'keys:ctrl+c'])
  })
  it('agent qui ne s’arrête pas : erreur claire', async () => {
    const { d } = fakeHerdr({ exitOn: null })
    await expect(stopAgent(d, { id: 'w1:p1', agent: 'claude', status: 'idle' })).rejects.toThrow('ne s’est pas arrêté')
  })
  it('relance avec les arguments du plan, sous le même nom', async () => {
    const { d, calls } = fakeHerdr({ exitOn: null })
    const plan = planRestart({ kind: 'claude', argv: ['claude'], session: ID, hadSession: true })
    await startAgent(d, { id: 'w1:p1', agent: 'claude', name: 'claude-ab12' }, plan)
    expect(calls).toEqual([`start:${JSON.stringify(['--resume', ID])}`])
  })
})
