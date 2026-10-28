import { describe, expect, it, vi } from 'vitest'
import { runSplitCommand } from '../server/utils/splitCommand'

function setup(mode: 'free' | 'busy' | 'missing', options: { race?: boolean, unknown?: boolean } = {}) {
  let reads = 0
  const agent = { pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', agent: 'claude', cwd: '/project' }
  const shell = { pane_id: 'w1:p2', workspace_id: 'w1', tab_id: 'w1:t1' }
  const call = vi.fn(async (_machine: string, method: string, params: Record<string, unknown>) => {
    if (method === 'session.snapshot') return { panes: [agent, ...(mode === 'missing' ? [] : [shell])] }
    if (method === 'pane.split') return { pane: { ...shell, pane_id: 'w1:p3' } }
    if (method === 'pane.get') return { pane: shell }
    if (method === 'pane.process_info') {
      const busy = params.pane_id === 'w1:p2' && (mode === 'busy' || (options.race && ++reads > 1))
      return { process_info: options.unknown ? {} : { shell_pid: 10, foreground_process_group_id: busy ? 20 : 10, foreground_processes: [{ pid: busy ? 20 : 10 }] } }
    }
    return {}
  })
  return call
}

describe('run command in a split shell', () => {
  it.each(['free', 'busy', 'missing'] as const)('%s shell: executes only in a verified free pane on the agent machine', async mode => {
    const call = setup(mode)
    const r = await runSplitCommand('ab12~w1:p1', '! gcloud auth login', call)
    const target = mode === 'free' ? 'w1:p2' : 'w1:p3'
    expect(r).toEqual({ ok: true, pane_id: `ab12~${target}`, created: mode !== 'free' })
    expect(call.mock.calls.every(c => c[0] === 'ab12')).toBe(true)
    expect(call.mock.calls.filter(c => c[1] === 'pane.send_input').map(c => c[2])).toEqual([
      { pane_id: target, text: 'gcloud auth login', keys: ['enter'] },
    ])
    if (mode !== 'free') expect(call).toHaveBeenCalledWith('ab12', 'pane.split', { target_pane_id: 'w1:p1', direction: 'right', cwd: '/project', focus: false })
    else expect(call.mock.calls.some(c => c[1] === 'pane.split')).toBe(false)
    expect(call).toHaveBeenCalledWith('ab12', 'pane.focus', { pane_id: target })
  })

  it('does not type if the shell becomes busy before sending', async () => {
    const call = setup('free', { race: true })
    await expect(runSplitCommand('w1:p1', 'pwd', call)).rejects.toMatchObject({ code: 'busy_pane' })
    expect(call.mock.calls.some(c => c[1] === 'pane.send_input')).toBe(false)
  })

  it('serializes simultaneous requests that share the same shell', async () => {
    const base = setup('free')
    let sent = false
    const call = vi.fn(async (machine: string, method: string, params: Record<string, unknown>) => {
      if (method === 'pane.send_input') sent = true
      if (method === 'pane.process_info' && params.pane_id === 'w1:p2' && sent) {
        return { process_info: { shell_pid: 10, foreground_process_group_id: 20, foreground_processes: [{ pid: 20 }] } }
      }
      return base(machine, method, params)
    })
    const results = await Promise.all([runSplitCommand('w1:p1', 'sleep 10', call), runSplitCommand('w1:p1', 'pwd', call)])
    expect(results.map(r => r.pane_id)).toEqual(['w1:p2', 'w1:p3'])
  })

  it('fails closed when process readiness is unavailable', async () => {
    const call = setup('missing', { unknown: true })
    await expect(runSplitCommand('w1:p1', 'pwd', call)).rejects.toMatchObject({ code: 'busy_pane' })
    expect(call.mock.calls.some(c => c[1] === 'pane.send_input')).toBe(false)
  })

  it.each(['', 'pwd\nrm file', '\u001b[A'])('rejects invalid command %j before any RPC', async command => {
    const call = setup('free')
    await expect(runSplitCommand('w1:p1', command, call)).rejects.toMatchObject({ code: 'bad_command' })
    expect(call).not.toHaveBeenCalled()
  })
})
