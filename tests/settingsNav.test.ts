import { describe, expect, it } from 'vitest'
import { settingsBack } from '../app/utils/settingsNav'

describe('Back from Settings', () => {
  it('first closes the open section on the phone', () => {
    expect(settingsBack({ desk: false, section: 'terminal', historyBack: '/a/w1:p1' })).toBe('list')
  })
  it('goes back to the original view (agent, tab, home)', () => {
    expect(settingsBack({ desk: false, section: null, historyBack: '/a/w1:p1' })).toBe('history')
    expect(settingsBack({ desk: true, section: 'terminal', historyBack: '/t/w1:t2?pane=w1:p3' })).toBe('history')
    expect(settingsBack({ desk: false, section: null, historyBack: '/' })).toBe('history')
  })
  it('goes home without a known original view', () => {
    expect(settingsBack({ desk: false, section: null, historyBack: undefined })).toBe('home')
    expect(settingsBack({ desk: true, section: null, historyBack: null })).toBe('home')
    expect(settingsBack({ desk: true, section: 'about', historyBack: '/settings' })).toBe('home')
    expect(settingsBack({ desk: true, section: null, historyBack: 'https://ailleurs.example/' })).toBe('home')
  })
})

describe('Back from a section (phone)', () => {
  // The section is a history entry (?section=…): Back pops it,
  // like Android's Back button, instead of closing it without touching the history.
  it('goes back to the list by popping the section entry', () => {
    expect(settingsBack({ desk: false, section: 'terminal', historyBack: '/settings' })).toBe('history')
  })
  it('section opened directly (link): replaced by the list, without leaving Settings', () => {
    expect(settingsBack({ desk: false, section: 'plugins', historyBack: '/a/w1:p1' })).toBe('list')
    expect(settingsBack({ desk: false, section: 'plugins', historyBack: null })).toBe('list')
  })
})
