import { describe, expect, it } from 'vitest'
import { terminalClosedText, terminalUnavailableText } from '../app/utils/terminalClosed'

// Test language: English (no browser).
describe('raison de fermeture du terminal', () => {
  it('translates the server\'s known cases', () => {
    expect(terminalClosedText({ reason: 'Box injoignable', code: 'unreachable', machine: 'Box' })).toBe('Box unreachable')
    expect(terminalClosedText({ reason: 'machine inconnue', code: 'unknown_machine' })).toBe('unknown machine')
  })

  it('garde les messages de Herdr tels quels', () => {
    expect(terminalClosedText({ reason: 'terminal already has an attached client' })).toBe('terminal already has an attached client')
    expect(terminalClosedText({})).toBe('')
  })

  it('banner without French punctuation in English', () => {
    expect(terminalUnavailableText('Box unreachable')).toBe('Terminal unavailable: Box unreachable')
    expect(terminalUnavailableText(null)).toBe('Terminal unavailable')
  })
})
