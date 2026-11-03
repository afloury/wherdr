import { describe, expect, it } from 'vitest'
import { claudeFooterMode, launchOptions, planRestart, restartNotice } from '../shared/restart'

const ID = '00000000-0000-4000-8000-000000000001'

describe('options de lancement', () => {
  it('keeps Claude\'s known options, drops the conversation choice and the initial message', () => {
    const r = launchOptions('claude', ['claude', '--model', 'sonnet', '--resume', 'abc', '--permission-mode', 'plan', '--dangerously-skip-permissions', '--tmux', 'bonjour'])
    // --tmux: specific to the first launch, reported; --resume: replaced, silently.
    expect(r.kept.flat()).toEqual(['--model', 'sonnet', '--permission-mode', 'plan', '--dangerously-skip-permissions'])
    expect(r.dropped.flat()).toEqual(['--tmux'])
  })
  it('multi-value options and --option=value form', () => {
    const r = launchOptions('claude', ['/usr/bin/claude', '--add-dir', '/a', '/b', '--effort=high', '-c'])
    expect(r.kept.flat()).toEqual(['--add-dir', '/a', '/b', '--effort=high'])
    expect(r.dropped.flat()).toEqual([])
  })
  it('unknown option dropped with its value', () => {
    const r = launchOptions('claude', ['claude', '--mystere', 'x', '--verbose'])
    expect(r.kept.flat()).toEqual(['--verbose'])
    expect(r.dropped.flat()).toEqual(['--mystere', 'x'])
  })
  it('Codex launched by node, resume subcommand ignored', () => {
    const r = launchOptions('codex', ['node', '/opt/lib/codex.js', 'resume', '--last', '-m', 'gpt-x', '-s', 'workspace-write', '--yolo'])
    expect(r.kept.flat()).toEqual(['-m', 'gpt-x', '-s', 'workspace-write', '--yolo'])
    expect(r.dropped.flat()).toEqual([])
  })
  it('omp: keeps its launch options, never replays the API key', () => {
    const r = launchOptions('omp', ['omp', '--profile', 'work', '--thinking=high', '--api-key', 'k', '-c', '--auto-approve', 'hello'])
    expect(r.kept.flat()).toEqual(['--profile', 'work', '--thinking=high', '--auto-approve'])
    expect(r.dropped.flat()).toEqual(['--api-key', 'k'])
  })
})

describe('commande de relance', () => {
  it('Claude: resumes the conversation by its id, without the original model (restored by --resume)', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude', '--model', 'haiku', '--effort', 'low'], session: ID, hadSession: true })
    expect(p.mode).toBe('resume')
    expect(p.args).toEqual(['--effort', 'low', '--resume', ID])
  })
  it('Claude: effort and permission mode read on screen replace the original ones', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude', '--effort', 'low', '--permission-mode', 'plan'], session: ID, hadSession: true, current: { effort: 'High', permissionMode: 'acceptEdits' } })
    expect(p.args).toEqual(['--effort', 'high', '--permission-mode', 'acceptEdits', '--resume', ID])
  })
  it('Claude: default mode on screen removes the original mode; unknown effort ignored', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude', '--permission-mode', 'plan'], session: ID, hadSession: true, current: { effort: 'turbo', permissionMode: 'default' } })
    expect(p.args).toEqual(['--resume', ID])
  })
  it('Claude without a session id: --continue, with the original options', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude', '--model', 'haiku'], session: null, hadSession: false })
    expect(p).toMatchObject({ mode: 'continue', args: ['--model', 'haiku', '--continue'] })
  })
  it('empty conversation (id without a transcript): fresh relaunch, nothing to resume', () => {
    const p = planRestart({ kind: 'claude', argv: ['claude'], session: null, hadSession: true })
    expect(p).toMatchObject({ mode: 'fresh', args: [] })
  })
  it('Codex : resume <id>, sinon resume --last', () => {
    expect(planRestart({ kind: 'codex', argv: ['codex', '-m', 'gpt-x'], session: ID, hadSession: true }).args).toEqual(['resume', '-m', 'gpt-x', ID])
    expect(planRestart({ kind: 'codex', argv: ['codex'], session: null, hadSession: false }).args).toEqual(['resume', '--last'])
  })
  it('omp: --resume <session file>, model and thinking left to the session; --continue otherwise', () => {
    const file = '/tmp/sessions/-repo/2026-01-01T00-00-00-000Z_x.jsonl'
    const argv = ['omp', '--model', 'opus', '--thinking', 'low', '--profile', 'work']
    expect(planRestart({ kind: 'omp', argv, session: file, hadSession: true }).args).toEqual(['--profile', 'work', '--resume', file])
    expect(planRestart({ kind: 'omp', argv, session: null, hadSession: false }).args).toEqual(['--model', 'opus', '--thinking', 'low', '--profile', 'work', '--continue'])
  })
  it('command line not found: reported', () => {
    expect(planRestart({ kind: 'claude', argv: null, session: ID, hadSession: true }).unknownArgs).toBe(true)
  })
})

describe('confirmation', () => {
  const quiet = { mode: 'resume' as const, kept: [], dropped: [], unknownArgs: false }
  it('idle agent, everything found: no modal', () => {
    expect(restartNotice('idle', quiet).confirm).toBe(false)
    expect(restartNotice('done', quiet).confirm).toBe(false)
  })
  it('agent au travail ou en attente : avertissement', () => {
    expect(restartNotice('working', quiet)).toMatchObject({ confirm: true, busy: true })
    expect(restartNotice('blocked', quiet)).toMatchObject({ confirm: true, busy: true })
  })
  it('options lost or empty conversation: modal even when idle', () => {
    expect(restartNotice('idle', { ...quiet, unknownArgs: true })).toMatchObject({ confirm: true, defaults: true })
    expect(restartNotice('idle', { ...quiet, dropped: ['--mystere'] }).confirm).toBe(true)
    expect(restartNotice('idle', { ...quiet, mode: 'fresh' }).confirm).toBe(true)
  })
})

describe('permission mode on screen', () => {
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
