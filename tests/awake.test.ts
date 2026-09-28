import { describe, expect, it } from 'vitest'
import { CONTROL_SCRIPT, STATUS_SCRIPT, parseAssertions, parseAwakeStatus, parseBattery } from '../server/utils/awake'

describe('machine sleep controls', () => {
  it('reads Mac battery and power source', () => {
    expect(parseBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1) 87%; charging"))
      .toEqual({ percent: 87, source: 'ac' })
    expect(parseBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 43%; discharging"))
      .toEqual({ percent: 43, source: 'battery' })
  })
  it('reads the recorded inhibitor and expiry', () => {
    expect(parseAwakeStatus('platform=mac\nawake=123|1727500000|1\n')).toMatchObject({ supported: true, active: true, until: 1727500000000, lid: true })
    expect(parseAwakeStatus('platform=linux\n')).toMatchObject({ supported: false, active: false })
    expect(parseAwakeStatus('platform=linux\ninhibit=1\n')).toMatchObject({ supported: true, active: false })
  })
  it('extracts sleep assertions and identifies ours by PID', () => {
    const raw = 'pid 123(caffeinate): [0x1] 00:12:34 PreventUserIdleSystemSleep named: "wherdr"\n' +
      'pid 99(Backup App): [0x2] 01:02:03 PreventSystemSleep named: "Backup"\n'
    expect(parseAssertions(raw, 123)).toEqual([
      { name: 'caffeinate', kind: 'PreventUserIdleSystemSleep', seconds: 754, ours: true },
      { name: 'Backup App', kind: 'PreventSystemSleep', seconds: 3723, ours: false },
    ])
  })
  it('uses exact PID and bounded inhibitor commands', () => {
    expect(CONTROL_SCRIPT).toContain('kill "$old_pid"')
    expect(CONTROL_SCRIPT).toContain('caffeinate -i -s -t "$seconds"')
    expect(CONTROL_SCRIPT).toContain('systemd-inhibit --what=idle:sleep sleep "$seconds"')
    expect(CONTROL_SCRIPT).toContain('(20 - hour) * 3600')
    expect(STATUS_SCRIPT).toContain('ps -p "$pid" -o comm=')
  })
})
