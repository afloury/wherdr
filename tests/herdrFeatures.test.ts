import { describe, expect, it } from 'vitest'
import { parseMachineDiagnostic } from '../shared/machineDiagnostics'
import { terminalCell } from '../app/utils/terminalMouse'

describe('terminal mouse cells', () => {
  it('uses zero-based cells with screen geometry and clamps a release outside the screen', () => {
    const rect = { left: 20, top: 30, width: 800, height: 400 }
    expect(terminalCell(25, 35, rect, 80, 20)).toEqual({ column: 0, row: 0 })
    expect(terminalCell(415, 235, rect, 80, 20)).toEqual({ column: 39, row: 10 })
    expect(terminalCell(900, -10, rect, 80, 20)).toEqual({ column: 79, row: 0 })
    expect(terminalCell(0, 0, { ...rect, width: 0 }, 80, 20)).toBeNull()
  })
})

describe('saved machine diagnostics', () => {
  const id = 'abcdef0123456789abcdef0123456789'
  it.each(['reachable', 'auth required', 'error', 'disabled'])('preserves %s without confusing it with the wherdr SSH state', status => {
    expect(parseMachineDiagnostic(JSON.stringify([{ id, status, error: 'diagnostic' }]), id)).toEqual({
      supported: true, status, error: 'diagnostic', reconnect: `herdr machine reconnect '${id}'`,
    })
  })
  it('requires a matching profile and a known status', () => {
    for (const raw of ['', '[]', '{}', 'null', JSON.stringify([{ id: 'other', status: 'reachable' }]), JSON.stringify([{ id, status: 'online' }])]) {
      expect(parseMachineDiagnostic(raw, id)).toBeNull()
    }
  })
})
