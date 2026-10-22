import { describe, expect, it } from 'vitest'
import { cleanTerminalMouse, hasTerminalMouse } from '../shared/herdrFeatures'
import { parseMachineDiagnostic } from '../shared/machineDiagnostics'
import { terminalCell } from '../app/utils/terminalMouse'

describe('Herdr terminal capabilities', () => {
  it('enables mouse only for known versions starting at 0.9.2', () => {
    for (const version of ['0.9.2', 'herdr 0.9.5\n', '0.10.0', '1.0.0']) expect(hasTerminalMouse(version)).toBe(true)
    for (const version of ['', 'e2e', '0.9.1', '0.8.99', 'unknown']) expect(hasTerminalMouse(version)).toBe(false)
  })
  it('uses zero-based cells with screen geometry and clamps a release outside the screen', () => {
    const rect = { left: 20, top: 30, width: 800, height: 400 }
    expect(terminalCell(25, 35, rect, 80, 20)).toEqual({ column: 0, row: 0 })
    expect(terminalCell(415, 235, rect, 80, 20)).toEqual({ column: 39, row: 10 })
    expect(terminalCell(900, -10, rect, 80, 20)).toEqual({ column: 79, row: 0 })
    expect(terminalCell(0, 0, { ...rect, width: 0 }, 80, 20)).toBeNull()
  })
  it('validates structured mouse events without forwarding extra fields', () => {
    const event = { action: 'down', button: 'left', column: 3, row: 2, modifiers: 4 }
    expect(cleanTerminalMouse({ ...event, text: 'bad' }, 80, 24)).toEqual({ type: 'terminal.mouse', ...event })
    for (const bad of [{ action: 'click' }, { action: ['down'] }, { button: ['left'] }, { button: 'other' }, { column: -1 }, { column: 80 }, { row: 24 }, { row: 1.2 }, { modifiers: 16 }, { modifiers: '0' }]) {
      expect(cleanTerminalMouse({ ...event, ...bad }, 80, 24)).toBeNull()
    }
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
