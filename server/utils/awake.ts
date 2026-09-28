import { execFile } from 'node:child_process'
import type { Machine } from './machines'
import type { ExecResult } from './fsx'
import { HerdrError } from './herdr'

export type AwakeMode = 'hour' | 'fourHours' | 'evening' | 'untilOff' | 'extend'
export interface AwakeState {
  supported: boolean
  platform: 'mac' | 'linux' | 'other'
  active: boolean
  until: number | null
  lid: boolean
  battery: { percent: number, source: 'ac' | 'battery' } | null
}
export interface SleepAssertion { name: string, kind: string, seconds: number, ours: boolean }

// Reconnaît notre inhibiteur : PID + commande exacte + heure de démarrage
// enregistrée (un PID recyclé par un autre caffeinate n'est pas le nôtre).
const OURS = `ours() {
  case "$1" in *[!0-9]*|'') return 1;; esac
  args=$(ps -p "$1" -o args= 2>/dev/null) || return 1
  case "$args" in
    caffeinate\\ -i*|*/caffeinate\\ -i*|systemd-inhibit\\ --what=idle:sleep*|*/systemd-inhibit\\ --what=idle:sleep*) ;;
    *) return 1;;
  esac
  [ -z "\${2:-}" ] || [ "$(started "$1")" = "$2" ]
}
started() { ps -p "$1" -o lstart= 2>/dev/null | sed 's/ *$//'; }`

export const STATUS_SCRIPT = `${OURS}
platform=$(uname -s)
case "$platform" in Darwin) platform=mac;; Linux) platform=linux;; *) platform=other;; esac
echo "platform=$platform"
if [ "$platform" = mac ]; then pmset -g batt 2>/dev/null; fi
if [ "$platform" = linux ]; then command -v systemd-inhibit >/dev/null 2>&1 && echo "inhibit=1"; fi
d="$HOME/.cache/herdr-web/awake.pid"
if [ -f "$d" ]; then
  IFS='|' read -r pid until lid start < "$d" || true
  case "$until" in *[!0-9]*|'') until=0;; esac
  if ours "$pid" "\${start:-}" && { [ "$until" -eq 0 ] || [ "$until" -gt "$(date +%s)" ]; }; then
    echo "awake=$pid|$until|$lid"
  else rm -f "$d"; fi
fi`

// Remplacement sans trou : le nouvel inhibiteur est lancé et vérifié vivant
// AVANT d'arrêter l'ancien. Tuer d'abord laissait le Mac sans assertion un
// instant ; inactif depuis longtemps, il partait aussitôt en veille.
// stdout/stderr du processus restent fermés pour que le mux SSH rende la main.
// Erreurs attendues : ligne « error=<code> » (sortie 0).
export const CONTROL_SCRIPT = `set -u
${OURS}
mode=$1; lid=$2
dir="$HOME/.cache/herdr-web"; d="$dir/awake.pid"
mkdir -p "$dir"
fail() { echo "error=$1"; exit 0; }
platform=$(uname -s)
now=$(date +%s)
old_pid=; old_until=0; old_lid=0; old_start=
if [ -f "$d" ]; then IFS='|' read -r old_pid old_until old_lid old_start < "$d" || true; fi
case "$old_until" in *[!0-9]*|'') old_until=0;; esac
ours "$old_pid" "$old_start" || old_pid=
if [ "$mode" = off ]; then
  [ -z "$old_pid" ] || kill "$old_pid" 2>/dev/null || true
  rm -f "$d"; echo "stopped"; exit 0
fi
case "$mode" in
  hour) seconds=3600;; fourHours) seconds=14400;;
  evening) hour=$(expr "$(date +%H)" + 0); minute=$(expr "$(date +%M)" + 0); seconds=$(( (20 - hour) * 3600 - minute * 60 )); [ "$seconds" -gt 0 ] || fail evening_past;;
  untilOff) seconds=0;;
  extend) { [ -n "$old_pid" ] && [ "$old_until" -gt "$now" ]; } || fail not_active; seconds=$((old_until - now + 3600));;
  *) fail bad_mode;;
esac
until=0; [ "$seconds" -eq 0 ] || until=$((now + seconds))
if [ "$platform" = Darwin ]; then
  command -v caffeinate >/dev/null 2>&1 || fail no_tool
  flags=-i; [ "$lid" != 1 ] || flags="-i -s"
  if [ "$seconds" -eq 0 ]; then nohup caffeinate $flags </dev/null >/dev/null 2>&1 &
  else nohup caffeinate $flags -t "$seconds" </dev/null >/dev/null 2>&1 & fi
elif [ "$platform" = Linux ]; then
  command -v systemd-inhibit >/dev/null 2>&1 || fail no_tool
  [ "$lid" = 0 ] || fail lid_mac_only
  if [ "$seconds" -eq 0 ]; then nohup systemd-inhibit --what=idle:sleep sleep infinity </dev/null >/dev/null 2>&1 &
  else nohup systemd-inhibit --what=idle:sleep sleep "$seconds" </dev/null >/dev/null 2>&1 & fi
else fail no_tool; fi
pid=$!
sleep 1
# Échec : l'ancien inhibiteur (s'il y en a un) continue, fichier intact.
ours "$pid" || fail start_failed
start=$(started "$pid")
printf '%s|%s|%s|%s\\n' "$pid" "$until" "$lid" "$start" > "$d.tmp" && mv "$d.tmp" "$d"
if [ -n "$old_pid" ] && [ "$old_pid" != "$pid" ]; then kill "$old_pid" 2>/dev/null || true; fi
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
// Codes « error=… » du script de contrôle -> message (traduit côté client).
export const CONTROL_ERRORS: Record<string, string> = {
  no_tool: 'Contrôle de veille indisponible sur cette machine',
  lid_mac_only: 'Capot fermé disponible uniquement sur Mac',
  evening_past: 'Il est déjà 20 h passées',
  not_active: 'Aucun éveil en cours à prolonger',
  bad_mode: 'option de veille invalide',
  start_failed: 'Le maintien éveillé n’a pas démarré ; l’état précédent est conservé',
}
export function parseControl(raw: string): { error: string } | { started: number | null } {
  const error = /^error=(\w+)$/m.exec(raw)?.[1]
  if (error) return { error }
  return { started: Number(/^started=(\d+)$/m.exec(raw)?.[1]) || null }
}

export async function setAwake(machine: Machine, mode: AwakeMode | 'off', lid: boolean) {
  const status = await awakeStatus(machine)
  if (!status.supported) throw new HerdrError('awake_unsupported', CONTROL_ERRORS.no_tool!)
  if (mode === 'extend') {
    if (!status.active || !status.until) throw new HerdrError('awake_not_active', CONTROL_ERRORS.not_active!)
    lid = status.lid
  }
  if (lid && status.platform !== 'mac') throw new HerdrError('awake_lid', CONTROL_ERRORS.lid_mac_only!)
  if (lid && status.battery?.source !== 'ac') throw new HerdrError('awake_lid', 'Le capot fermé nécessite le secteur')
  const result = parseControl(await run(machine, CONTROL_SCRIPT, [mode, lid ? '1' : '0']))
  if ('error' in result) throw new HerdrError(`awake_${result.error}`, CONTROL_ERRORS[result.error] || 'Commande de veille impossible')
  const after = await awakeStatus(machine)
  // L'état renvoyé est celui du processus réel : s'il n'est pas là, c'est un échec.
  if (mode !== 'off' && !after.active) throw new HerdrError('awake_start_failed', CONTROL_ERRORS.start_failed!)
  return after
}
export async function sleepAssertions(machine: Machine) {
  const status = await awakeStatus(machine)
  if (status.platform !== 'mac') return []
  const raw = await run(machine, ASSERTIONS_SCRIPT)
  const pid = /^awake=(\d+)/m.exec(await run(machine, STATUS_SCRIPT))
  return parseAssertions(raw, pid ? Number(pid[1]) : undefined)
}
