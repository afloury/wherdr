import { describe, expect, it } from 'vitest'
import { isAutopilotWake } from '../app/utils/autopilotWake'

describe('autopilot wake attribution', () => {
  it.each(['Autopilot: Check the board.', 'Autopilot woke: Check the board.\nBoard context: ready'])('recognizes the exact prefix: %s', (text) => {
    expect(isAutopilotWake({ role: 'user', text })).toBe(true)
  })
  it.each(['Discuss Autopilot: today', '> Autopilot: quoted', '"Autopilot woke: quoted"', '\nAutopilot: indented', ' Autopilot:', 'autopilot:', 'Autopilot wake:', 'A human message'])('keeps ordinary text human: %s', (text) => {
    expect(isAutopilotWake({ role: 'user', text })).toBe(false)
  })
  it.each(['assistant', 'system', 'thinking', 'tool'])('ignores the %s role', (role) => {
    for (const text of ['Autopilot:', 'Autopilot woke:']) expect(isAutopilotWake({ role, text })).toBe(false)
  })
})
