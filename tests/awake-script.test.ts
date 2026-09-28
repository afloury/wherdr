import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONTROL_SCRIPT, STATUS_SCRIPT, parseAwakeStatus, parseControl } from '../server/utils/awake'

// Les vrais scripts, exécutés avec un faux caffeinate (journal start/stop) et un
// faux uname (Darwin) dans un HOME temporaire.
let root: string, home: string, bin: string, log: string
const pidFile = () => join(home, '.cache/herdr-web/awake.pid')
const env = () => ({ PATH: `${bin}:/usr/bin:/bin`, HOME: home })
const control = (mode: string, lid = '0') => execFileSync('sh', ['-c', CONTROL_SCRIPT, 'sh', mode, lid], { env: env(), encoding: 'utf8' })
const status = () => parseAwakeStatus(execFileSync('sh', ['-c', STATUS_SCRIPT], { env: env(), encoding: 'utf8' }))
// Un zombie (orphelin non récolté, ex. Docker sans --init) compte comme mort.
function alive(pid: number) {
  try { process.kill(pid, 0) }
  catch { return false }
  try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')) }
  catch { return true }
}
async function gone(pid: number) {
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise(r => setTimeout(r, 100))
  return !alive(pid)
}
// Les scripts lisent /proc (Linux) ou `ps -p` (macOS) : sans l'un ni l'autre, on ignore.
const canInspect = existsSync(`/proc/${process.pid}/stat`)
  || Boolean(spawnSync('ps', ['-p', String(process.pid), '-o', 'args='], { encoding: 'utf8' }).stdout?.trim())
// État lisible d'un PID, pour que l'échec dise pourquoi (hors de ce Mac/Docker).
function why(pid: number) {
  const read = (f: string) => { try { return readFileSync(f, 'utf8').replaceAll('\0', ' ').trim() } catch { return '-' } }
  return `pid ${pid} stat=[${read(`/proc/${pid}/stat`)}] cmdline=[${read(`/proc/${pid}/cmdline`)}] pidfile=[${read(pidFile())}] events=[${read(log)}]`
}
const events = () => readFileSync(log, 'utf8').trim().split('\n')
function fakeCaffeinate(body: string) {
  writeFileSync(join(bin, 'caffeinate'), `#!/bin/sh\n${body}\n`)
  chmodSync(join(bin, 'caffeinate'), 0o755)
}
// Le script n'est jamais réécrit pendant qu'un caffeinate l'exécute (sh relit
// son script au fil de l'eau) : l'échec de lancement passe par un fichier témoin.
const LIVE = `[ ! -f "${'$'}FAIL" ] || exit 1; echo "start $$" >> "${'$'}LOG"; trap 'echo "stop $$" >> "${'$'}LOG"; kill $! 2>/dev/null; exit 0' TERM; sleep 30 & wait`

describe.skipIf(process.platform === 'win32' || !canInspect)('keep-awake control script', { timeout: 20000 }, () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'awake-'))
    home = join(root, 'home'); bin = join(root, 'bin'); log = join(root, 'events.log')
    mkdirSync(home); mkdirSync(bin); writeFileSync(log, '')
    writeFileSync(join(bin, 'uname'), '#!/bin/sh\necho Darwin\n'); chmodSync(join(bin, 'uname'), 0o755)
    fakeCaffeinate(LIVE.replaceAll('$LOG', log).replaceAll('$FAIL', join(root, 'fail')))
  })
  afterEach(() => {
    if (existsSync(pidFile())) {
      const pid = Number(readFileSync(pidFile(), 'utf8').split('|')[0])
      if (pid && alive(pid)) process.kill(pid)
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('re-arming starts the new inhibitor before stopping the old one', async () => {
    const first = parseControl(control('fourHours'))
    expect(first).toMatchObject({ started: expect.any(Number) })
    const a = (first as { started: number }).started
    const second = parseControl(control('hour'))
    const b = (second as { started: number }).started
    expect(b).not.toBe(a)
    expect(alive(b)).toBe(true)
    // Aucun instant sans assertion : B démarre, puis A s'arrête.
    await gone(a)
    expect(events()).toEqual([`start ${a}`, `start ${b}`, `stop ${a}`])
    const s = status()
    expect(s.active).toBe(true)
    expect(Math.round((s.until! - Date.now()) / 1000)).toBeGreaterThan(3590)
    expect(Math.round((s.until! - Date.now()) / 1000)).toBeLessThanOrEqual(3600)
  })

  it('extends by one hour from the current end', () => {
    control('hour')
    const before = status().until!
    const out = parseControl(control('extend'))
    expect(out).toMatchObject({ started: expect.any(Number) })
    expect(Math.abs(status().until! - (before + 3600_000))).toBeLessThanOrEqual(2000)
  })

  it('refuses to extend when nothing is active', () => {
    expect(parseControl(control('extend'))).toEqual({ error: 'not_active' })
  })

  it('keeps the previous inhibitor when the new one fails to start', () => {
    const a = (parseControl(control('hour')) as { started: number }).started
    const saved = readFileSync(pidFile(), 'utf8')
    writeFileSync(join(root, 'fail'), '')
    expect(parseControl(control('fourHours')), why(a)).toEqual({ error: 'start_failed' })
    expect(alive(a), why(a)).toBe(true)
    expect(readFileSync(pidFile(), 'utf8')).toBe(saved)
    expect(status().active).toBe(true)
  })

  it('shows "not awake" once the recorded process is dead', async () => {
    const a = (parseControl(control('hour')) as { started: number }).started
    process.kill(a)
    expect(await gone(a)).toBe(true)
    expect(status().active).toBe(false)
    expect(existsSync(pidFile())).toBe(false)
  })

  it('ignores a recorded PID whose end time has passed', () => {
    const a = (parseControl(control('hour')) as { started: number }).started
    const [, , lid, start] = readFileSync(pidFile(), 'utf8').trim().split('|')
    writeFileSync(pidFile(), `${a}|${Math.floor(Date.now() / 1000) - 10}|${lid}|${start}\n`)
    expect(status().active).toBe(false)
    process.kill(a)
  })

  it('does not adopt a recycled PID started at another time', () => {
    const a = (parseControl(control('hour')) as { started: number }).started
    writeFileSync(pidFile(), `${a}|0|0|Thu Jan  1 00:00:00 2026\n`)
    expect(status().active, why(a)).toBe(false)
    // Et « off » ne tue pas un processus qui n'est pas le nôtre.
    writeFileSync(pidFile(), `${a}|0|0|Thu Jan  1 00:00:00 2026\n`)
    control('off')
    expect(alive(a), why(a)).toBe(true)
    process.kill(a)
  })

  it('turns off by exact PID', async () => {
    const a = (parseControl(control('untilOff')) as { started: number }).started
    expect(status()).toMatchObject({ active: true, until: null })
    expect(control('off')).toContain('stopped')
    expect(await gone(a)).toBe(true)
    expect(status().active).toBe(false)
  })
})
