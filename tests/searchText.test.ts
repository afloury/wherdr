import { describe, expect, it } from 'vitest'
import { excerpt, highlightParts, matchAt, matchRange, stripMarkdown } from '../shared/searchText'

const around = (text: string, q: string, width = 120) => excerpt(text, matchAt(text, q), width, q)

describe('cleaning excerpt markdown', () => {
  it('removes bold, italics, code, links and strikethrough', () => {
    expect(stripMarkdown('- **Affichage** : `docker compose` et *vite* ~~non~~'))
      .toBe('Affichage : docker compose et vite non')
    expect(stripMarkdown('Voir [la doc](https://herdr.dev/docs(v2)) et ![logo](a.png)')).toBe('Voir la doc et logo')
    expect(stripMarkdown('<https://herdr.dev>')).toBe('https://herdr.dev')
  })

  it('retire titres, listes, citations, blocs de code et tableaux', () => {
    const md = '## Titre\n\n> citation\n1. un\n2) deux\n```ts\nconst a = 1\n```\n| A | B |\n|---|:-:|\n| x | y |\n---\nfin'
    expect(stripMarkdown(md)).toBe('Titre citation un deux const a = 1 A · B x · y fin')
  })

  it('leaves identifiers and operations intact', () => {
    expect(stripMarkdown('snake_case_name et 2 * 3 * 4 et __init__.py')).toBe('snake_case_name et 2 * 3 * 4 et __init__.py')
  })

  it('erases the leftovers of cut markdown', () => {
    expect(stripMarkdown('ts passent. - **Affich')).toBe('ts passent. - Affich')
    expect(stripMarkdown('a ` b')).toBe('a b')
  })
})

describe('coupe des extraits', () => {
  const long = 'Les tests passent ; un 143e est sauté dans Docker, faute de python3 dans l’image de test. '
    + '- **Affichage** : Codex, comme Claude, garde son modèle et son effort dans la barre de saisie après un redémarrage complet.'

  it('cuts on word boundaries, with ellipses', () => {
    const e = around('prefixe '.repeat(20) + long, 'docker', 100)
    expect(e.startsWith('…')).toBe(true)
    expect(e.endsWith('…')).toBe(true)
    const body = e.slice(1, -1)
    const words = ('prefixe '.repeat(20) + stripMarkdown(long)).split(' ')
    // Premier et dernier mot entiers.
    expect(words).toContain(body.split(' ')[0])
    expect(words.map(w => w.replace(/[,;:]$/, ''))).toContain(body.split(' ').at(-1))
    expect(e).toContain('Docker')
    expect(e).not.toMatch(/\*\*|`/)
  })

  it('does not stick an ellipsis after a finished sentence', () => {
    expect(around('aaa docker bbb. ccccccccc dddd', 'docker', 16)).toBe('aaa docker bbb.')
  })

  it('adds no ellipsis when the text fits', () => {
    expect(around('Un **éléphant** bleu', 'elephant')).toBe('Un éléphant bleu')
  })

  it('keeps the match even after removing the markdown before it', () => {
    const text = '**'.repeat(200) + ' ' + '`code` '.repeat(60) + 'le mot cherché éléphant ici'
    expect(around(text, 'elephant', 60)).toContain('éléphant')
  })

  it('cuts an oversized word sharply rather than losing the match', () => {
    const text = 'x'.repeat(400) + 'docker' + 'y'.repeat(400)
    const e = around(text, 'docker', 60)
    expect(e).toContain('docker')
    expect(e.length).toBeLessThanOrEqual(62)
  })

  it('stays readable when the match is in a link address', () => {
    const e = around('Voir [la page](https://exemple.fr/docker) pour la suite.', 'docker')
    expect(e).toBe('Voir la page pour la suite.')
  })
})

describe('surlignage', () => {
  it('finds the match ignoring accents and case', () => {
    expect(matchRange('Un Éléphant', 'elephant')).toEqual([3, 11])
    expect(matchRange('éle', 'éle')).toEqual([0, 4])
    expect(highlightParts('Un Éléphant bleu', 'elephant')).toEqual([
      { text: 'Un ', hit: false }, { text: 'Éléphant', hit: true }, { text: ' bleu', hit: false },
    ])
    expect(highlightParts('rien', 'x')).toEqual([{ text: 'rien', hit: false }])
  })
})
