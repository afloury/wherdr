import { describe, expect, it } from 'vitest'
import { quotaLevel, quotaShown, readQuotaDisplay } from '../app/utils/quotas'

const now = 1_000_000
describe('affichage des quotas : restant ou utilisé', () => {
  it('Restant par défaut, Utilisé sur demande', () => {
    expect(readQuotaDisplay(null)).toBe('left')
    expect(readQuotaDisplay('bizarre')).toBe('left')
    expect(readQuotaDisplay('used')).toBe('used')
  })
  it('convertit la part restante en part utilisée', () => {
    const w = { used: 32.4, resetsAt: now + 3600000 }
    expect(quotaShown(w, now, 'left')).toBe(68)
    expect(quotaShown(w, now, 'used')).toBe(32)
    // Session épuisée : 0 % restant, 100 % utilisé.
    expect(quotaShown({ used: 100, resetsAt: now + 60000 }, now, 'used')).toBe(100)
    // Fenêtre réinitialisée depuis la lecture : rien d'utilisé.
    expect(quotaShown({ used: 90, resetsAt: now - 1 }, now, 'used')).toBe(0)
  })
  it('garde l’alerte liée à ce qui reste, quel que soit l’affichage', () => {
    expect(quotaLevel({ used: 95, resetsAt: now + 60000 }, now)).toBe('hi')
    expect(quotaLevel({ used: 5, resetsAt: now + 60000 }, now)).toBe('lo')
  })
})
