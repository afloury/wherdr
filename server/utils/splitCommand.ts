import { PANE_RE, joinId, splitId } from '../../shared/ids'
import { herdrOn, HerdrError, sleep } from './herdr'
import { reduceSnapshot } from './snapshot'
import { prepareSplitShell, SPLIT_PROMPT_TOKEN, SPLIT_TERMINAL_TOKEN } from './splitShell'

type Call = typeof herdrOn
const pending = new Map<string, Promise<unknown>>()

// Serialize our own sends on each machine, including across different agents
// sharing a tab. Never infer readiness from the cached UI state.
export async function runSplitCommand(paneId: string, raw: unknown, call: Call = herdrOn, prepare = prepareSplitShell) {
  if (!PANE_RE.test(paneId)) throw new HerdrError('bad_pane', 'Pane not found')
  const command = typeof raw === 'string' ? raw.trim().replace(/^!\s*/, '') : ''
  if (!command || /[\r\n\x00-\x1f\x7f]/.test(command)) throw new HerdrError('bad_command', 'Expected a single shell command')
  const { machine, local } = splitId(paneId)
  const previous = pending.get(machine)
  const task = (async () => {
    await previous?.catch(() => {})
    const hx = (method: string, params: Record<string, unknown> = {}) => call(machine, method, params)
    const snap = await hx('session.snapshot')
    const state = reduceSnapshot(snap.snapshot || snap)
    const agent = state.panes.find(p => p.id === local)
    if (!agent?.agent || !agent.cwd) throw new HerdrError('bad_pane', 'Pane not found')
    const ready = async (id: string) => {
      const p = (await hx('pane.get', { pane_id: id })).pane
      if (!p || p.tokens?.[SPLIT_TERMINAL_TOKEN] !== '1' || p.agent || p.tab_id !== agent.tab) return false
      const info = (await hx('pane.process_info', { pane_id: id })).process_info
      return Boolean(info?.shell_pid > 0 && p.tokens?.[SPLIT_PROMPT_TOKEN] === String(info.shell_pid) && info.foreground_process_group_id === info.shell_pid
        && info.foreground_processes?.length && info.foreground_processes.every((p: { pid: number }) => p.pid === info.shell_pid))
    }
    let target: string | undefined
    for (const p of state.panes.filter(p => p.id !== local && p.tab === agent.tab && !p.agent)) {
      if (await ready(p.id)) { target = p.id; break }
    }
    // Only this action's marked terminals are eligible. A shell that loses
    // readiness while we focus it is left untouched; create another split.
    if (target) {
      await hx('pane.focus', { pane_id: target })
      if (!await ready(target)) target = undefined
    }
    const created = !target
    if (!target) {
      const r = await hx('pane.split', { target_pane_id: local, direction: 'right', cwd: agent.cwd, focus: false, env: await prepare(machine) })
      target = r.pane?.pane_id
      if (!target) throw new HerdrError('bad_pane', 'Pane not found')
      await hx('pane.report_metadata', { pane_id: target, source: 'wherdr-split', tokens: { [SPLIT_TERMINAL_TOKEN]: '1' } })
      // A new shell needs a moment to start. Never buffer text into an
      // unverified pane, even when it was just created by this request.
      for (let i = 0; i < 20; i++) {
        if (await ready(target)) break
        await sleep(100)
      }
    }
    if (created) await hx('pane.focus', { pane_id: target })
    if (created && !await ready(target)) throw new HerdrError('busy_pane', 'Cannot verify an idle shell prompt. No command was sent.')
    await hx('pane.report_metadata', { pane_id: target, source: 'wherdr-split', tokens: { [SPLIT_PROMPT_TOKEN]: null } })
    await hx('pane.send_input', { pane_id: target, text: command, keys: ['enter'] })
    return { ok: true, pane_id: joinId(machine, target), created }
  })()
  pending.set(machine, task)
  try { return await task }
  finally { if (pending.get(machine) === task) pending.delete(machine) }
}
