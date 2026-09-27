import { describe, expect, it } from 'vitest'
import { previewStart, typingSample } from '../app/utils/typingPreview'

describe('aperçu de la machine à écrire', () => {
  it('exemple dans la langue de l’app, avec liste et bloc de code', () => {
    for (const lang of ['fr', 'en']) {
      const s = typingSample(lang)
      expect(s).toMatch(/^- /m)
      expect(s).toContain('```ts\n')
    }
    expect(typingSample('fr')).toContain('Tous les tests passent.')
    expect(typingSample('en')).toContain('All tests pass.')
    expect(typingSample('de')).toBe(typingSample('en'))
  })

  it('désactivée : affichée d’un coup ; sinon déroulée depuis maintenant', () => {
    expect(previewStart('off', 1000)).toBeNull()
    expect(previewStart('fast', 1000)).toBe(1000)
    expect(previewStart('slow', 2000)).toBe(2000)
  })
})
