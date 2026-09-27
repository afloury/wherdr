import { describe, expect, it } from 'vitest'
import { settingsBack } from '../app/utils/settingsNav'

describe('Retour depuis les Réglages', () => {
  it('ferme d’abord la section ouverte sur téléphone', () => {
    expect(settingsBack({ desk: false, section: 'terminal', historyBack: '/a/w1:p1' })).toBe('list')
  })
  it('revient à la vue d’origine (agent, onglet, accueil)', () => {
    expect(settingsBack({ desk: false, section: null, historyBack: '/a/w1:p1' })).toBe('history')
    expect(settingsBack({ desk: true, section: 'terminal', historyBack: '/t/w1:t2?pane=w1:p3' })).toBe('history')
    expect(settingsBack({ desk: false, section: null, historyBack: '/' })).toBe('history')
  })
  it('va à l’accueil sans vue d’origine connue', () => {
    expect(settingsBack({ desk: false, section: null, historyBack: undefined })).toBe('home')
    expect(settingsBack({ desk: true, section: null, historyBack: null })).toBe('home')
    expect(settingsBack({ desk: true, section: 'about', historyBack: '/settings' })).toBe('home')
    expect(settingsBack({ desk: true, section: null, historyBack: 'https://ailleurs.example/' })).toBe('home')
  })
})
