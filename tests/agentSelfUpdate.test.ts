import { describe, expect, it, vi } from 'vitest'
import { updateChoices, updateRestartPlan, updateShellSignature } from '../shared/selfUpdate'
import { createSelfUpdates } from '../server/utils/agentSelfUpdate'
import type { ChatResponse, Pane } from '../shared/types'

const SESSION = '00000000-0000-4000-8000-000000000288'
const OUTPUT = 'Updating Codex via installer...\nCodex CLI 0.162.1 installed successfully.\n\n🎉 Update ran successfully! Please restart Codex.\n\nuser@host project % '
const pane = (agent: string | null = 'codex') => ({ id: 'w1:p1', workspace: 'w1', agent, agentSession: null, bornAt: 9000, status: 'idle', cwd: '/tmp/project' }) as Pane

describe('Codex self-update output', () => {
  it('accepts the real installer ending and a multiline prompt', () => {
    expect(updateShellSignature(OUTPUT)).toBe('user@host project %')
    expect(updateShellSignature(OUTPUT.replace('user@host project % ', 'project on main\n❯ '))).toBe('project on main\n❯')
  })
  it.each([
    OUTPUT + 'echo hello', OUTPUT + 'echo #', OUTPUT + 'echo >',
    OUTPUT + "echo '\n> ", OUTPUT + 'cat <<EOF\n> ',
    OUTPUT.replace('user@host project % ', 'arbitrary output\n❯ '),
    OUTPUT.replace('user@host project % ', '> '),
    OUTPUT.replace('user@host project % ', '❯ echo %'),
    OUTPUT + '\nsome subsequent output',
    OUTPUT.replace('Codex CLI 0.162.1 installed successfully.', 'a quoted example'),
    OUTPUT.replace('🎉 Update ran', '> 🎉 Update ran'),
    OUTPUT.replace('user@host project % ', ''),
    'Update available! Please restart Codex.',
  ])('rejects a draft, a quote, an incomplete or stale ending', text => {
    expect(updateShellSignature(text)).toBeNull()
  })
})

describe('conversation choice', () => {
  const argv = ['codex', '-m', 'gpt-x', '--profile', 'work', '-C', '/tmp/project']
  it('replays the original startup command for a new conversation', () => {
    const launch = { argv: [...argv, 'Initial task'], session: null, conversation: 'empty' as const }
    expect(updateChoices(launch)).toEqual(['restart'])
    expect(updateRestartPlan(launch, 'restart').args).toEqual(launch.argv.slice(1))
  })
  it('resumes the exact transcript with its original launch options', () => {
    const launch = { argv: [...argv, 'resume', '--last'], session: SESSION, conversation: 'existing' as const }
    expect(updateChoices(launch)).toEqual(['resume', 'fresh'])
    expect(updateRestartPlan(launch, 'resume').args).toEqual(['resume', ...argv.slice(1), SESSION])
    expect(updateRestartPlan(launch, 'fresh').args).toEqual(argv.slice(1))
  })
  it('offers both choices when uncertain, opens a picker rather than --last', () => {
    const launch = { argv: null, session: null, conversation: 'unknown' as const }
    expect(updateChoices(launch)).toEqual(['resume', 'fresh'])
    expect(updateRestartPlan(launch, 'resume').args).toEqual(['resume'])
    expect(updateRestartPlan(launch, 'fresh').args).toEqual([])
    expect(updateChoices({ argv: ['codex', 'resume', '--last'], session: null, conversation: 'empty' })).toEqual(['resume', 'fresh'])
  })
})

function setup(chat: ChatResponse = { available: false, reason: 'not_found' }) {
  let now = 10000
  let shell = false
  let output = ''
  let pid = 2001
  let argv = ['codex', '--profile', 'work']
  const call = vi.fn(async (method: string) => method === 'pane.read'
    ? { read: { text: output } }
    : { process_info: { shell_pid: 2000, foreground_process_group_id: shell ? 2000 : pid,
        foreground_processes: shell ? [{ pid: 2000, name: 'zsh' }] : [{ pid, name: 'codex', argv }] } })
  const deps = { call, sleep: async () => {}, now: () => now, chat: async () => chat }
  const monitor = createSelfUpdates(deps)
  return { monitor, deps, call, tick: (ms = 5000) => { now += ms }, exit: () => { shell = true; output = OUTPUT },
    replace: (args: string[]) => { pid++; argv = args },
    output: (text: string) => { output = text }, foreground: () => { shell = false; pid++ } }
}

describe('observed process lifecycle and final guards', () => {
  it('keeps the pane blocked after exit, and validates the current empty shell', async () => {
    const s = setup()
    await s.monitor.observe(pane(), false)
    s.exit()
    expect(await s.monitor.observe(pane(null), false)).toBe(false)
    s.tick()
    const stopped = pane(null)
    expect(await s.monitor.observe(stopped, false)).toBe(true)
    expect(stopped).toMatchObject({ agent: 'codex', status: 'blocked', stopped: { reason: 'update' }, prompt: { options: [{ label: 'Restart Codex' }] } })
    expect(await s.monitor.check(stopped.id)).not.toBeNull()
    s.output(OUTPUT + 'echo hello')
    expect(await s.monitor.check(stopped.id)).toBeNull()
    s.output(OUTPUT)
    s.foreground()
    expect(await s.monitor.check(stopped.id)).toBeNull()
  })
  it('uses a verified transcript instead of a potentially incorrect Herdr session', async () => {
    const s = setup({ available: true, session: SESSION, items: [{ role: 'user', text: 'Hello', ts: null }] })
    await s.monitor.observe(pane(), false)
    expect(s.monitor.get('w1:p1')).toMatchObject({ session: SESSION, conversation: 'existing' })
  })
  it('forgets the previous conversation when the same process starts a new session', async () => {
    const chat: ChatResponse = { available: true, session: SESSION, items: [{ role: 'user', text: 'Hello', ts: null }] }
    const s = setup(chat)
    await s.monitor.observe(pane(), false)
    chat.session = '00000000-0000-4000-8000-000000000289'
    chat.items = []
    s.tick()
    await s.monitor.observe(pane(), false)
    expect(s.monitor.get('w1:p1')).toMatchObject({ session: chat.session, conversation: 'empty' })
  })
  it('refreshes a reported session change immediately, before the polling throttle', async () => {
    const chat: ChatResponse = { available: true, session: SESSION, items: [] }
    const s = setup(chat)
    await s.monitor.observe(pane(), false)
    chat.items = [{ role: 'user', text: 'Continue the task', ts: null }]
    await s.monitor.observe({ ...pane(), agentSession: SESSION }, false)
    expect(s.monitor.get('w1:p1')?.conversation).toBe('existing')
  })
  it('checks messages written between the last live sample and the exit', async () => {
    const chat: ChatResponse = { available: true, session: SESSION, items: [] }
    const s = setup(chat)
    await s.monitor.observe(pane(), false)
    chat.items = [{ role: 'user', text: 'Finish this task', ts: null }]
    s.exit()
    await s.monitor.observe(pane(null), false)
    s.tick()
    const stopped = pane(null)
    await s.monitor.observe(stopped, false)
    expect(stopped.prompt?.options.map(o => o.label)).toEqual(['Resume conversation', 'Start fresh'])
    expect(s.monitor.get(stopped.id)?.session).toBe(SESSION)
  })
  it('does not claim that a failed transcript read means an empty conversation', async () => {
    const s = setup()
    s.deps.chat = async () => { throw new Error('offline') }
    const m = createSelfUpdates(s.deps)
    await m.observe(pane(), false)
    expect(m.get('w1:p1')?.conversation).toBe('unknown')
  })
  it.each(["echo '\n> ", 'cat <<EOF\n> '])('rejects a multiline draft entered before the delayed exit check: %s', async draft => {
    const s = setup()
    await s.monitor.observe(pane(), false)
    s.exit()
    s.output(OUTPUT + draft)
    await s.monitor.observe(pane(null), false)
    s.tick()
    const stopped = pane(null)
    expect(await s.monitor.observe(stopped, false)).toBe(false)
    expect(stopped.stopped).toBeUndefined()
    expect(await s.monitor.check(stopped.id)).toBeNull()
  })
  it('invalidates exact A when guessed B is observed, even if the final read fails', async () => {
    const chat: ChatResponse = { available: true, session: SESSION, items: [{ role: 'user', text: 'Conversation A', ts: null }] }
    const s = setup(chat)
    await s.monitor.observe({ ...pane(), agentSession: SESSION }, false)
    chat.session = '00000000-0000-4000-8000-000000000289'
    chat.guessed = true
    chat.items = [{ role: 'user', text: 'Conversation B', ts: null }]
    await s.monitor.observe(pane(), false)
    expect(s.monitor.get('w1:p1')?.session).toBeNull()
    s.deps.chat = async () => { throw new Error('final read failed') }
    s.exit()
    await s.monitor.observe(pane(null), false)
    s.tick()
    const stopped = pane(null)
    await s.monitor.observe(stopped, false)
    expect(stopped.prompt?.options.map(o => o.label)).toEqual(['Resume conversation', 'Start fresh'])
    expect(updateRestartPlan(s.monitor.get(stopped.id)!, 'resume').args).toEqual(['resume', '--profile', 'work'])
  })
  it('offers both choices when the final read fails after a successful empty observation', async () => {
    const s = setup({ available: true, session: SESSION, items: [] })
    await s.monitor.observe(pane(), false)
    expect(s.monitor.get('w1:p1')?.conversation).toBe('empty')
    s.deps.chat = async () => { throw new Error('first messages are unreadable') }
    s.exit()
    await s.monitor.observe(pane(null), false)
    s.tick()
    const stopped = pane(null)
    await s.monitor.observe(stopped, false)
    expect(s.monitor.get(stopped.id)?.conversation).toBe('unknown')
    expect(stopped.prompt?.options.map(o => o.label)).toEqual(['Resume conversation', 'Start fresh'])
    expect(updateRestartPlan(s.monitor.get(stopped.id)!, 'resume').args).toEqual(['resume', '--profile', 'work', SESSION])
  })
  it.each([false, true])('captures a replacement process inside the throttle (birth changed: %s)', async birthChanged => {
    const s = setup()
    await s.monitor.observe(pane(), false)
    s.tick(1000)
    s.replace(['codex', '--profile', 'second', 'second task'])
    await s.monitor.observe({ ...pane(), ...(birthChanged ? { bornAt: 11000 } : {}) }, false)
    expect(s.monitor.get('w1:p1')?.pid).toBe(2002)
    s.exit()
    await s.monitor.observe(pane(null), false)
    s.tick()
    await s.monitor.observe(pane(null), false)
    expect(updateRestartPlan(s.monitor.get('w1:p1')!, 'restart').args).toEqual(['--profile', 'second', 'second task'])
  })
  it('does not infer an empty session when attaching to an already running Codex', async () => {
    const s = setup()
    await s.monitor.observe({ ...pane(), bornAt: undefined }, false)
    expect(s.monitor.get('w1:p1')?.conversation).toBe('unknown')
  })
  it('never triggers on a quote while Codex is alive, or in an unrelated shell pane', async () => {
    const s = setup()
    s.output(OUTPUT)
    expect(await s.monitor.observe(pane(), false)).toBe(false)
    expect(await setup().monitor.observe(pane(null), false)).toBe(false)
    s.exit()
    await s.monitor.observe(pane(null), false)
    s.tick()
    expect(await s.monitor.observe(pane(null), false)).toBe(false)
  })
  it('checks exit only once: printing an old update later does not trigger', async () => {
    const s = setup()
    await s.monitor.observe(pane(), false)
    s.exit()
    s.output('user@host project % ')
    await s.monitor.observe(pane(null), false)
    s.tick()
    expect(await s.monitor.observe(pane(null), false)).toBe(false)
    s.output(OUTPUT)
    s.tick()
    expect(await s.monitor.observe(pane(null), false)).toBe(false)
  })
  it('ignores wherdr-owned restarts and prunes removed panes', async () => {
    const s = setup()
    expect(await s.monitor.observe(pane(), true)).toBe(false)
    expect(s.call).not.toHaveBeenCalled()
    await s.monitor.observe(pane(), false)
    s.monitor.prune(new Set(), () => true)
    expect(s.monitor.get('w1:p1')).toBeUndefined()
  })
  it('retains the original command and pending card across a service restart', async () => {
    const s = setup()
    await s.monitor.observe(pane(), false)
    s.exit()
    await s.monitor.observe(pane(null), false)
    s.tick()
    await s.monitor.observe(pane(null), false)
    const restored = createSelfUpdates(s.deps, JSON.parse(JSON.stringify([['w1:p1', s.monitor.get('w1:p1')]])))
    expect(await restored.observe(pane(null), false)).toBe(true)
    expect((await restored.check('w1:p1'))?.argv).toEqual(['codex', '--profile', 'work'])
  })
  it('does not arm old live records after a long service outage', async () => {
    const s = setup()
    await s.monitor.observe(pane(), false)
    const saved = JSON.parse(JSON.stringify([['w1:p1', s.monitor.get('w1:p1')]]))
    for (let i = 0; i < 5; i++) s.tick()
    const restored = createSelfUpdates(s.deps, saved)
    s.exit()
    await restored.observe(pane(null), false)
    s.tick()
    expect(await restored.observe(pane(null), false)).toBe(false)
  })
})
