// The machine wherdr runs on, as file reads, quotas and notifications see it.
// Remote core machines are built per request from core's state (coreFilesMachine.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { MachineInfo } from '../../shared/types'
import { LOCAL, splitId } from '../../shared/ids'
import { DATA_DIR, HOME, HOST_LABEL } from './env'
import { type MachineFs, type ShellExec, localFs } from './fsx'

const LOCAL_LABEL_FILE = path.join(DATA_DIR, 'machine-label.txt')
// The name the user gave this machine in the app ('' = none).
function renamedLabel() {
  try { return fs.readFileSync(LOCAL_LABEL_FILE, 'utf8').trim().slice(0, 40) }
  catch { return '' }
}
export const localMachineLabel = () => localMachine.label
function localOs() {
  const p = os.platform()
  return p === 'darwin' ? 'Darwin' : p === 'linux' ? 'Linux' : p
}

export interface Machine {
  key: string // '' = local
  profileId: string | null
  label: string
  local: boolean
  session: string
  status: MachineInfo['status']
  error: string | null
  home: string
  // `uname -s` of the machine: 'Darwin' (macOS), 'Linux'… ('' until known).
  os: string
  fs: MachineFs
  exec: ShellExec | null // shell commands (remote machines)
  // Remote machines: a shell script whose output is streamed (a video); null when offline.
  spawnShell?: (script: string, args: string[]) => ChildProcessWithoutNullStreams | null
  info: () => MachineInfo
}

export const localMachine: Machine = {
  key: LOCAL,
  profileId: null,
  label: renamedLabel() || HOST_LABEL,
  local: true,
  session: 'default',
  status: 'online',
  error: null,
  home: HOME,
  os: localOs(),
  fs: localFs,
  exec: null,
  info: () => ({ key: LOCAL, session: localMachine.session, label: localMachine.label, local: true, status: 'online', error: null, os: localMachine.os }),
}

export const getMachine = (key: string | null | undefined): Machine | undefined => (!key ? localMachine : undefined)
export const machineOfPane = (id: string | null | undefined) => getMachine(splitId(String(id || '')).machine)
