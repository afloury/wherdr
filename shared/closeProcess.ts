export type CloseProcess = { state: 'idle' | 'unknown' } | { state: 'running', command: string }

interface ProcessInfo {
  shell_pid?: number
  foreground_process_group_id?: number
  foreground_processes?: { pid: number, argv?: string[], name?: string, cmdline?: string }[]
}

// Only a fresh process-group inspection can attest to an idle shell. Titles
// and the card's cached command can outlive the command that produced them.
export function closeProcess(info?: ProcessInfo | null): CloseProcess {
  const procs = info?.foreground_processes
  if (!info?.shell_pid || !Array.isArray(procs) || !procs.length) return { state: 'unknown' }
  if (info.foreground_process_group_id === info.shell_pid && procs.every(p => p.pid === info.shell_pid)) return { state: 'idle' }
  const p = procs.find(p => p.pid !== info.shell_pid)
  const argv = p?.argv?.length ? p.argv : [p?.cmdline || p?.name || '']
  const command = argv.join(' ').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 160)
  return command ? { state: 'running', command } : { state: 'unknown' }
}

export function closeProcessMessage(p: { agent: string | null, stopped?: unknown }, process: CloseProcess, tl: (en: string, fr: string) => string): string {
  if (p.agent && !p.stopped) return tl('The process will be stopped.', 'Le processus sera arrêté.')
  if (process.state === 'idle') return ''
  if (process.state === 'running') return tl(`The running command “${process.command}” will be stopped.`, `La commande en cours « ${process.command} » sera arrêtée.`)
  return tl('Anything running in it will be stopped.', 'Tout ce qui y est en cours d’exécution sera arrêté.')
}
