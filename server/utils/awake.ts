import { execFile } from 'node:child_process'
import type { Machine } from './machines'
import type { ExecResult } from './fsx'

export type AwakeMode = 'hour' | 'fourHours' | 'evening' | 'untilOff'
export interface AwakeState {
  supported: boolean
  platform: 'mac' | 'linux' | 'other'
  active: boolean
  until: number | null
  lid: boolean
  battery: { percent: number, source: 'ac' | 'battery' } | null
}
export interface SleepAssertion { name: string, kind: string, seconds: number, ours: boolean }

export const STATUS_SCRIPT = `platform=$(uname -s)
case "$platform" in Darwin) platform=mac;; Linux) platform=linux;; *) platform=other;; esac
echo "platform=$platform"
if [ "$platform" = mac ]; then pmset -g batt 2>/dev/null; fi
if [ "$platform" = linux ]; then command -v systemd-inhibit >/dev/null 2>&1 && echo "inhibit=1"; fi
d="$HOME/.cache/herdr-web/awake.pid"
if [ -f "$d" ]; then
  IFS='|' read -r pid until lid < "$d"
  case "$pid" in *[!0-9]*|'') exit 0;; esac
  cmd=$(ps -p "$pid" -o comm= 2>/dev/null | sed 's|.*/||')
  if { [ "$platform" = mac ] && [ "$cmd" = caffeinate ]; } || { [ "$platform" = linux ] && [ "$cmd" = systemd-inhibit ]; }; then
    echo "awake=$pid|$until|$lid"
  else rm -f "$d"; fi
fi`

// The process keeps stdout/stderr closed so the SSH mux returns immediately.
export const CONTROL_SCRIPT = `set -eu
mode=$1; lid=$2
d="$HOME/.cache/herdr-web/awake.pid"
mkdir -p "$HOME/.cache/herdr-web"
platform=$(uname -s)
now=$(date +%s)
if [ "$mode" = off ]; then seconds=0
else
  case "$mode" in
    hour) seconds=3600;; fourHours) seconds=14400;;
    evening) hour=$(expr "$(date +%H)" + 0); minute=$(expr "$(date +%M)" + 0); seconds=$(( (20 - hour) * 3600 - minute * 60 )); [ "$seconds" -gt 0 ] || exit 2;;
    untilOff) seconds=0;; *) exit 2;;
  esac
fi
if [ -f "$d" ]; then
  IFS='|' read -r old_pid old_until old_lid < "$d" || true
  case "$old_pid" in *[!0-9]*|'') ;; *)
    cmd=$(ps -p "$old_pid" -o comm= 2>/dev/null | sed 's|.*/||')
    if [ "$cmd" = caffeinate ] || [ "$cmd" = systemd-inhibit ]; then kill "$old_pid" 2>/dev/null || true; fi;;
  esac
  rm -f "$d"
fi
[ "$mode" = off ] && exit 0
until=0; [ "$seconds" -eq 0 ] || until=$((now + seconds))
if [ "$platform" = Darwin ]; then
  command -v caffeinate >/dev/null 2>&1 || exit 3
  if [ "$lid" = 1 ]; then
    if [ "$seconds" -eq 0 ]; then nohup caffeinate -i -s </dev/null >/dev/null 2>&1 &
    else nohup caffeinate -i -s -t "$seconds" </dev/null >/dev/null 2>&1 & fi
  else
    if [ "$seconds" -eq 0 ]; then nohup caffeinate -i </dev/null >/dev/null 2>&1 &
    else nohup caffeinate -i -t "$seconds" </dev/null >/dev/null 2>&1 & fi
  fi
elif [ "$platform" = Linux ]; then
  command -v systemd-inhibit >/dev/null 2>&1 || exit 3
  [ "$lid" = 0 ] || exit 2
  if [ "$seconds" -eq 0 ]; then nohup systemd-inhibit --what=idle:sleep sleep infinity </dev/null >/dev/null 2>&1 &
  else nohup systemd-inhibit --what=idle:sleep sleep "$seconds" </dev/null >/dev/null 2>&1 & fi
else exit 3; fi
pid=$!
printf '%s|%s|%s\\n' "$pid" "$until" "$lid" > "$d"
echo "started=$pid"`

export const ASSERTIONS_SCRIPT = 'pmset -g assertions 2>/dev/null'

export function parseBattery(raw: string): AwakeState['battery'] {
  const percent = /\b(\d{1,3})%/.exec(raw)
  if (!percent) return null
  return { percent: Math.min(100, Number(percent[1])), source: /AC Power/i.test(raw) ? 'ac' : 'battery' }
}

export function parseAwakeStatus(raw: string): AwakeState {
  const platform = /^platform=(mac|linux|other)$/m.exec(raw)?.[1] as AwakeState['platform'] | undefined || 'other'
  const match = /^awake=(\d+)\|(\d+)\|([01])$/m.exec(raw)
  return { platform, supported: platform === 'mac' || (platform === 'linux' && /^inhibit=1$/m.test(raw)),
    active: Boolean(match), until: match && Number(match[2]) ? Number(match[2]) * 1000 : null,
    lid: match?.[3] === '1', battery: platform === 'mac' ? parseBattery(raw) : null }
}

export function parseAssertions(raw: string, ownPid?: number): SleepAssertion[] {
  const rows: SleepAssertion[] = []
  for (const line of raw.split('\n')) {
    const m = /pid (\d+)\(([^)]+)\):.*? (\d{1,3}:\d\d:\d\d) (PreventUserIdleSystemSleep|PreventSystemSleep)\b/.exec(line)
    if (!m) continue
    const [hours, minutes, seconds] = m[3]!.split(':').map(Number)
    rows.push({ name: m[2]!, kind: m[4]!, seconds: hours! * 3600 + minutes! * 60 + seconds!, ours: Number(m[1]) === ownPid })
  }
  return rows
}

function localExec(script: string, args: string[]): Promise<ExecResult> {
  return new Promise(resolve => execFile('sh', ['-c', script, 'sh', ...args], { timeout: 10000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) =>
    resolve({ code: err ? 1 : 0, stdout: Buffer.from(stdout), stderr: String(stderr || err?.message || '') })))
}
async function run(machine: Machine, script: string, args: string[] = []) {
  const result = machine.exec ? await machine.exec(script, args, { timeoutMs: 10000 }) : await localExec(script, args)
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'Commande de veille impossible')
  return result.stdout.toString('utf8')
}
export async function awakeStatus(machine: Machine) { return parseAwakeStatus(await run(machine, STATUS_SCRIPT)) }
export async function setAwake(machine: Machine, mode: AwakeMode | 'off', lid: boolean) {
  const status = await awakeStatus(machine)
  if (!status.supported) throw new Error('Contrôle de veille indisponible sur cette machine')
  if (lid && status.platform !== 'mac') throw new Error('Capot fermé disponible uniquement sur Mac')
  if (lid && status.battery?.source !== 'ac') throw new Error('Le capot fermé nécessite le secteur')
  await run(machine, CONTROL_SCRIPT, [mode, lid ? '1' : '0'])
  return awakeStatus(machine)
}
export async function sleepAssertions(machine: Machine) {
  const status = await awakeStatus(machine)
  if (status.platform !== 'mac') return []
  const raw = await run(machine, ASSERTIONS_SCRIPT)
  const pid = /^awake=(\d+)/m.exec(await run(machine, STATUS_SCRIPT))
  return parseAssertions(raw, pid ? Number(pid[1]) : undefined)
}
