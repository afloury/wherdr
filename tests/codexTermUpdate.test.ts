// Codex update typed into the agent's terminal: the command line and its end
// marker, the refusals, and the whole sequence against a fake pane whose
// screens change like a real one (Codex, then the shell, then the installer).
// The real installer never runs here.
import { describe, expect, it } from 'vitest'
import {
  CODEX_STANDALONE_COMMAND, codexMenuOpen, codexUpdateState, terminalUpdateDone, terminalUpdateLine,
} from '../shared/codexStatus'
import { planRestart } from '../shared/restart'
import { type TermUpdatePhase, checkTerminalUpdate, updateInTerminal } from '../server/utils/codexTermUpdate'
import type { RestartDeps } from '../server/utils/restartSeq'

const ID = '00000000-0000-4000-8000-000000000002'
const NPM = 'npm install -g @openai/codex'

describe('terminalUpdateLine', () => {
  it('types the known command then the marker with the exit status', () => {
    expect(terminalUpdateLine(NPM, 'ab12cd', 'bash')).toBe(`${NPM}; echo __WHERDR_DONE_ab12cd_$?"__"`)
    expect(terminalUpdateLine(` ${NPM}  `, 'ab12cd', '-zsh')).toBe(`${NPM}; echo __WHERDR_DONE_ab12cd_$?"__"`)
    expect(terminalUpdateLine(CODEX_STANDALONE_COMMAND, 'ab12cd', '/usr/bin/fish')).toBe(`${CODEX_STANDALONE_COMMAND}; echo __WHERDR_DONE_ab12cd_$status"__"`)
  })
  it('refuses anything but a known command, and unknown shells', () => {
    expect(() => terminalUpdateLine(`${NPM}; rm -rf ~`, 'ab12cd', 'bash')).toThrow('unknown update command')
    expect(() => terminalUpdateLine('curl -fsSL https://example.com/x.sh | sh', 'ab12cd', 'bash')).toThrow('unknown update command')
    expect(() => terminalUpdateLine(NPM, 'a;b', 'bash')).toThrow('bad marker')
    expect(terminalUpdateLine(NPM, 'ab12cd', 'nu')).toBeNull()
    expect(terminalUpdateLine(NPM, 'ab12cd', null)).toBeNull()
  })
})

describe('terminalUpdateDone', () => {
  const typed = `$ ${NPM}; echo __WHERDR_DONE_ab12cd_$?"__"`
  it('still running while only the typed line is on screen', () => {
    expect(terminalUpdateDone(`${typed}\nfetching…`, 'ab12cd')).toBeNull()
  })
  it('reads the exit status and the last line printed', () => {
    expect(terminalUpdateDone(`${typed}\nadded 1 package\n__WHERDR_DONE_ab12cd_0__\n$ `, 'ab12cd')).toEqual({ code: 0, last: 'added 1 package' })
    expect(terminalUpdateDone(`${typed}\nnpm error: EACCES\n\n__WHERDR_DONE_ab12cd_243__\n$ `, 'ab12cd')).toEqual({ code: 243, last: 'npm error: EACCES' })
    expect(terminalUpdateDone(`${typed}\n__WHERDR_DONE_ab12cd_1__`, 'ab12cd')).toEqual({ code: 1, last: null })
  })
  it('ignores the marker of another run', () => {
    expect(terminalUpdateDone('__WHERDR_DONE_zz99zz_0__', 'ab12cd')).toBeNull()
  })
})

describe('codexMenuOpen', () => {
  it('sees the startup update menu, not the input field', () => {
    const menu = `  Update available · 0.159.1 → 0.160.0
› 1. Update now (runs \`npm install -g @openai/codex\`)
  2. Skip
  3. Skip until next version
  enter continue · esc skip`
    expect(codexMenuOpen(menu)).toBe(true)
    expect(codexMenuOpen('  >_ OpenAI Codex (v0.159.1)\n› Ask Codex to do anything\n  gpt-5.5 medium · ~/demo')).toBe(false)
  })
})

describe('update method per machine', () => {
  const base = { running: '0.159.1', latest: '0.160.0', installed: null, standalone: false, screen: { command: NPM } }
  it('direct when the server can run it, otherwise in the agent terminal', () => {
    expect(codexUpdateState({ ...base, canRun: true })).toMatchObject({ method: 'direct', runnable: true })
    expect(codexUpdateState({ ...base, canRun: false })).toMatchObject({ method: 'terminal', runnable: true })
  })
  it('an unknown command is only copied', () => {
    expect(codexUpdateState({ ...base, screen: { command: 'curl https://example.com | sh' }, canRun: false })).toMatchObject({ method: null, runnable: false })
  })
})

// Fake pane: Codex at its field, its shell, then the installer (a few reads).
function fakePane(o: { exit?: boolean, code?: number, status?: string, shell?: string | null, menu?: boolean, installReads?: number, never?: boolean } = {}) {
  let t = 0
  let fg: 'codex' | 'shell' | 'install' = 'codex'
  let screen = '  >_ OpenAI Codex (v0.159.1)\n› Ask Codex to do anything\n'
  let typed = ''
  let reads = 0
  const calls: string[] = []
  const phases: TermUpdatePhase[] = []
  const d: RestartDeps & { phase: (p: TermUpdatePhase) => void, nonce: () => string } = {
    now: () => t,
    sleep: async (ms) => { t += ms },
    nonce: () => 'ab12cd',
    phase: p => phases.push(p),
    call: async (method, params) => {
      if (method === 'pane.send_input') {
        const what = params.text ? `text:${params.text}` : `keys:${(params.keys as string[]).join(',')}`
        calls.push(what)
        if (params.text) typed += String(params.text)
        if (what === 'keys:enter') {
          if (fg === 'codex' && typed === '/exit' && o.exit !== false) { fg = 'shell'; screen += '$ ' }
          else if (fg === 'shell') { fg = 'install'; screen += `${typed}\n`; reads = 0 }
          typed = ''
        }
        return {}
      }
      if (method === 'pane.read') {
        if (fg === 'install' && !o.never && ++reads >= (o.installReads ?? 3)) {
          const code = o.code ?? 0
          screen += `${code ? 'npm error: fake failure' : 'added 1 package'}\n__WHERDR_DONE_ab12cd_${code}__\n$ `
          fg = 'shell'
        }
        return { read: { text: o.menu ? `${screen}› 1. Update now\n  2. Skip\n  enter continue · esc skip\n` : screen } }
      }
      if (method === 'pane.get') return { pane: { agent_status: o.status || 'idle' } }
      if (method === 'pane.process_info') {
        const shellName = o.shell === undefined ? 'bash' : o.shell
        const procs = fg === 'codex' ? [{ pid: 20, name: 'codex', argv: ['codex', 'resume', ID] }]
          : fg === 'install' ? [{ pid: 30, name: 'npm', argv: ['npm'] }] : [{ pid: 10, name: shellName, argv: [shellName] }]
        return { process_info: { shell_pid: o.shell === null ? null : 10, foreground_process_group_id: fg === 'shell' ? 10 : fg === 'codex' ? 20 : 30, foreground_processes: procs } }
      }
      if (method === 'agent.start') { calls.push(`start:${JSON.stringify(params.args || [])}`); fg = 'codex'; return {} }
      throw new Error(method)
    },
  }
  return { d, calls, phases, screen: () => screen }
}

const agent = (status = 'idle') => ({ id: 'w1:p1', agent: 'codex', status, name: 'codex-ab12' })
const plan = planRestart({ kind: 'codex', argv: ['codex', '-m', 'gpt-x', 'resume', ID], session: ID, hadSession: true })

describe('terminal update sequence', () => {
  it('exits Codex, types the command, waits for its end, resumes the conversation', async () => {
    const { d, calls, phases } = fakePane()
    await checkTerminalUpdate(d, agent())
    await updateInTerminal(d, agent(), plan, NPM)
    expect(calls).toEqual([
      'text:/exit', 'keys:enter',
      `text:${NPM}; echo __WHERDR_DONE_ab12cd_$?"__"`, 'keys:enter',
      `start:${JSON.stringify(['resume', '-m', 'gpt-x', ID])}`,
    ])
    expect(phases).toEqual(['stopping', 'updating', 'starting'])
  })
  it('a failed command leaves the pane at its shell with the error', async () => {
    const { d, calls, phases } = fakePane({ code: 1 })
    await expect(updateInTerminal(d, agent(), plan, NPM)).rejects.toThrow('The update command failed (exit 1): npm error: fake failure')
    expect(phases).toEqual(['stopping', 'updating'])
    expect(calls.some(c => c.startsWith('start:'))).toBe(false)
  })
  it('an update that never ends times out without restarting', async () => {
    const { d, calls } = fakePane({ never: true })
    await expect(updateInTerminal(d, agent(), plan, NPM)).rejects.toThrow('did not finish')
    expect(calls.some(c => c.startsWith('start:'))).toBe(false)
  })
  it('Codex that does not exit: nothing is typed at all', async () => {
    const { d, calls } = fakePane({ exit: false })
    await expect(updateInTerminal(d, agent(), plan, NPM)).rejects.toThrow('did not stop')
    expect(calls.filter(c => c.includes('npm'))).toEqual([])
  })
  it('a command not on the list is never typed', async () => {
    const { d, calls } = fakePane()
    await expect(updateInTerminal(d, agent(), plan, 'npm install -g evil')).rejects.toThrow('unknown update command')
    expect(calls.filter(c => c.includes('evil'))).toEqual([])
  })
  it('unsupported shell: stops at the prompt, nothing typed', async () => {
    const { d, calls } = fakePane({ shell: 'nu' })
    await expect(updateInTerminal(d, agent(), plan, NPM)).rejects.toThrow('Unsupported shell (nu)')
    expect(calls).toEqual(['text:/exit', 'keys:enter'])
  })
})

describe('refusals before anything is typed', () => {
  it('working or waiting for an answer', async () => {
    for (const s of ['working', 'blocked']) {
      const { d, calls } = fakePane({ status: s })
      await expect(checkTerminalUpdate(d, agent(s))).rejects.toThrow('working or waiting')
      expect(calls).toEqual([])
    }
  })
  it('Codex not started from a shell (the pane would close)', async () => {
    const { d } = fakePane({ shell: null })
    await expect(checkTerminalUpdate(d, agent())).rejects.toThrow('not started from a shell')
  })
  it('a Codex menu open', async () => {
    const { d, calls } = fakePane({ menu: true })
    await expect(checkTerminalUpdate(d, agent())).rejects.toThrow('showing a menu')
    expect(calls).toEqual([])
  })
})
