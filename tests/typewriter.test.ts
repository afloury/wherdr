// Effet machine à écrire (t-0021) : découpage, vitesse, révélation du HTML
// final, et choix des réponses à dérouler (historique vs nouveau).
import { describe, expect, it } from 'vitest'
import {
  applyReveal, CATCHUP_MS, CIPHER_GAP, cipherSegments, effectiveTypingSpeed, encryptedTextActive, finishReveal, parseTypingSettings, pickTyping, planReveal, replyId, revealedAt,
  trailGlyphs, typeDuration, typingFronts, wordStops, TRAIL_GLYPHS, TYPE_MAX_MS, TYPE_MIN_MS,
} from '../app/utils/typewriter'
import type { RevealNode } from '../app/utils/typewriter'

type Fake = RevealNode & { tag?: string, cls?: string, childNodes: Fake[] }
const txt = (v: string): Fake => ({ nodeType: 3, nodeValue: v, childNodes: [] })
const el = (tag: string, kids: Fake[], cls?: string): Fake => ({ nodeType: 1, nodeValue: null, tag, cls, hidden: false, childNodes: kids })
const text = (n: Fake): string => (n.nodeType === 3 ? n.nodeValue || '' : n.hidden ? '' : n.childNodes.map(text).join(''))

describe('découpage', () => {
  it('avance mot par mot, espaces compris', () => {
    expect(wordStops('Bonjour le monde')).toEqual([8, 11, 16])
    expect(wordStops('  a b')).toEqual([4, 5])
    expect(wordStops('')).toEqual([0])
  })
  it('coupe les mots très longs en groupes de 8 caractères', () => {
    const s = '/home/user/code/app'
    const stops = wordStops(s)
    expect(stops[0]).toBe(8)
    expect(stops.at(-1)).toBe(s.length)
    for (let i = 1; i < stops.length; i++) expect(stops[i]! - stops[i - 1]!).toBeLessThanOrEqual(8)
  })
  it('révèle progressivement jusqu’au bout', () => {
    const stops = wordStops('un deux trois quatre')
    expect(revealedAt(stops, 0, 1000)).toBe(0)
    expect(revealedAt(stops, 500, 1000)).toBe(stops[1])
    expect(revealedAt(stops, 999, 1000)).toBe(stops[2])
    expect(revealedAt(stops, 1000, 1000)).toBe(20)
    const seq = [0, 100, 300, 600, 900].map(t => revealedAt(stops, t, 1000))
    expect([...seq].sort((a, b) => a - b)).toEqual(seq)
  })
})

describe('vitesse', () => {
  it('conserve la cadence rapide historique et multiplie les autres durées', () => {
    expect(typeDuration(10)).toBe(TYPE_MIN_MS)
    expect(typeDuration(300)).toBeGreaterThanOrEqual(1000)
    expect(typeDuration(450)).toBeLessThanOrEqual(2000)
    expect(typeDuration(20000)).toBe(TYPE_MAX_MS)
    expect(typeDuration(200)).toBeLessThan(typeDuration(400))
    for (const chars of [10, 300, 20000]) {
      expect(typeDuration(chars, 'fast')).toBe(typeDuration(chars))
      expect(typeDuration(chars, 'medium')).toBe(typeDuration(chars) * 2)
      expect(typeDuration(chars, 'slow')).toBe(typeDuration(chars) * 3)
      expect(typeDuration(chars, 'off')).toBe(0)
    }
    expect(typeDuration(20000, 'medium')).toBe(4000)
    expect(typeDuration(20000, 'slow')).toBe(6000)
  })
})

describe('révélation du HTML final', () => {
  // <p>Voici <b>du code</b> :</p> <div.code-block><div.code-head>…</div><pre><code>…</code></pre></div> <table>…</table>
  const build = () => {
    const head = el('div', [el('span', [txt('ts')]), el('button', [txt('Copier')])], 'code-head')
    const p = el('p', [txt('Voici '), el('b', [txt('du code')]), txt(' :')])
    const code = el('div', [head, el('pre', [el('code', [txt('const a = 1\nconst b = 2')])])], 'code-block')
    const cell = (s: string) => el('td', [txt(s)])
    const table = el('table', [el('tr', [cell('A'), cell('B')]), el('tr', [cell('C'), cell('D')])])
    const root = el('div', [p, txt('\n'), code, txt('\n'), table])
    const plan = planReveal(root, {
      atomic: n => (n as Fake).cls === 'code-head',
      keep: n => (n as Fake).tag === 'td',
    })
    return { root, p, code, head, table, plan }
  }

  it('ne compte ni les blancs de mise en page ni l’en-tête des blocs de code', () => {
    const { plan } = build()
    expect(plan.total).toBe('Voici du code :'.length + 'const a = 1\nconst b = 2'.length + 4)
  })

  it('masque ce qui n’a pas commencé, sans casser la structure', () => {
    const { root, p, code, head, table, plan } = build()
    applyReveal(plan, 9)
    expect(text(p)).toBe('Voici du ')
    expect(code.hidden).toBe(true)
    expect(table.hidden).toBe(true)
    // Le bloc de code apparaît avec son en-tête entier dès que son texte commence.
    applyReveal(plan, 16)
    expect(code.hidden).toBe(false)
    expect(head.hidden).toBe(false)
    expect(text(head)).toBe('tsCopier')
    expect(text(code).endsWith('c')).toBe(true)
    // Tableau : la ligne commencée garde ses deux cellules (la seconde vide).
    applyReveal(plan, plan.total - 3)
    const [r1, r2] = table.childNodes
    expect(r1!.hidden).toBe(false)
    expect(r1!.childNodes.map(c => c.hidden)).toEqual([false, false])
    expect(r2!.hidden).toBe(true)
    applyReveal(plan, plan.total - 1)
    expect(r2!.hidden).toBe(false)
    expect(text(r2!.childNodes[1]!)).toBe('')
    finishReveal(plan)
    expect(text(root)).toBe('Voici du code :\ntsCopierconst a = 1\nconst b = 2\nABCD')
  })

  it('montre l’élément sans texte dès que ce qui le précède est écrit', () => {
    const hr = el('hr', [])
    const root = el('div', [el('p', [txt('ab')]), hr, el('p', [txt('cd')])])
    const plan = planReveal(root)
    applyReveal(plan, 1)
    expect(hr.hidden).toBe(true)
    applyReveal(plan, 2)
    expect(hr.hidden).toBe(false)
    expect(root.childNodes[2]!.hidden).toBe(true)
  })
})

describe('deux fronts chiffrés', () => {
  const build = () => {
    const a = txt('Voici un ')
    const b = txt('lien')
    const p1 = el('p', [a, el('a', [b]), txt(' ok')])
    const p2 = el('p', [txt('Suite')])
    const root = el('div', [p1, txt('\n'), p2])
    return { root, p1, p2, a, b, plan: planReveal(root) }
  }

  it('la bande traverse les éléments Markdown et ne dépasse pas le front écrit', () => {
    const { plan, a, b } = build()
    expect(cipherSegments(plan, 6, 12)).toEqual([{ node: a, text: 'un ' }, { node: b, text: 'lie' }])
    expect(cipherSegments(plan, 12, 12)).toEqual([])
  })

  it('écrit du chiffré devant le texte déchiffré, selon la vitesse', () => {
    for (const speed of ['fast', 'medium', 'slow'] as const) {
      const total = 500
      const duration = typeDuration(total, speed)
      const halfway = typingFronts(total, duration / 2, speed)
      expect(halfway.written).toBe(250)
      expect(halfway.written - halfway.decrypted).toBe(CIPHER_GAP[speed])
      const atEnd = typingFronts(total, duration, speed)
      expect(atEnd).toEqual({ written: total, decrypted: total - CIPHER_GAP[speed], done: false })
      const catching = typingFronts(total, duration + CATCHUP_MS[speed] / 2, speed)
      expect(catching.decrypted).toBeGreaterThan(atEnd.decrypted)
      expect(catching.decrypted).toBeLessThan(total)
      expect(typingFronts(total, duration + CATCHUP_MS[speed], speed)).toEqual({ written: total, decrypted: total, done: true })
    }
    expect(typingFronts(12, typeDuration(12, 'slow') / 2, 'slow').decrypted).toBe(0)
    expect(typingFronts(0, 0, 'slow').done).toBe(true)
  })

  it('montre les éléments atteints par l’écriture et laisse le vrai texte derrière', () => {
    const { plan, p2 } = build()
    const start = 'Voici un lien ok'.length
    applyReveal(plan, start)
    expect(p2.hidden).toBe(true)
    applyReveal(plan, start - 2, true, start)
    expect(p2.hidden).toBe(false)
    expect(text(p2)).toBe('') // Les glyphes sont peints hors des nœuds texte.
    applyReveal(plan, start - 2, true, start - 2)
    expect(p2.hidden).toBe(true)
  })

  it('glyphes du jeu terminal, blancs conservés, même longueur', () => {
    let i = 0
    const rand = () => (i++ % 7) / 7
    const g = trailGlyphs('a b\tc\nd', rand)
    expect(g).toHaveLength(7)
    expect([g[1], g[3], g[5]]).toEqual([' ', '\t', '\n'])
    for (const c of [g[0], g[2], g[4], g[6]]) expect(TRAIL_GLYPHS).toContain(c)
    expect(trailGlyphs('xyz', () => 0.999999).every(c => c === TRAIL_GLYPHS.at(-1))).toBe(true)
  })
  it('garde les écarts croissants et plafonne à la longueur du message', () => {
    expect(CIPHER_GAP.fast).toBe(20)
    expect(CIPHER_GAP.medium).toBe(40)
    expect(CIPHER_GAP.slow).toBe(70)
    const fronts = typingFronts(10, typeDuration(10, 'slow'), 'slow')
    expect(fronts).toEqual({ written: 10, decrypted: 0, done: false })
  })
})

describe('réglages de saisie', () => {
  it('donne Moyenne avec texte chiffré sur un appareil neuf', () => {
    expect(parseTypingSettings(null, null, null, null)).toEqual({ speed: 'medium', encrypted: true })
  })
  it('migre les trois anciens modes et l’ancien interrupteur', () => {
    expect(parseTypingSettings(null, null, 'off', null)).toEqual({ speed: 'off', encrypted: true })
    expect(parseTypingSettings(null, null, 'plain', null)).toEqual({ speed: 'fast', encrypted: false })
    expect(parseTypingSettings(null, null, 'terminal', null)).toEqual({ speed: 'fast', encrypted: true })
    expect(parseTypingSettings(null, null, null, '0')).toEqual({ speed: 'off', encrypted: true })
    expect(parseTypingSettings(null, null, null, '1')).toEqual({ speed: 'medium', encrypted: true })
  })
  it('préfère les nouveaux choix et coupe les effets en mouvement réduit', () => {
    expect(parseTypingSettings('slow', '0', 'terminal', null)).toEqual({ speed: 'slow', encrypted: false })
    expect(effectiveTypingSpeed('slow', true)).toBe('off')
    expect(effectiveTypingSpeed('slow', false)).toBe('slow')
    expect(encryptedTextActive('off', true, false)).toBe(false)
    expect(encryptedTextActive('medium', false, false)).toBe(false)
    expect(encryptedTextActive('medium', true, true)).toBe(false)
    expect(encryptedTextActive('slow', true, false)).toBe(true)
  })
})

describe('historique vs nouveau', () => {
  const a = replyId({ ts: '2026-09-27T10:00:00Z', text: 'Première réponse' })
  const b = replyId({ ts: '2026-09-27T10:01:00Z', text: 'Deuxième réponse' })
  const c = replyId({ ts: '2026-09-27T10:02:00Z', text: 'Troisième réponse' })

  it('premier chargement : rien ne se déroule, tout devient connu', () => {
    const known = new Set<string>()
    expect(pickTyping(known, [a, b], false)).toBeNull()
    expect(known.has(a) && known.has(b)).toBe(true)
  })
  it('en direct : seule la dernière réponse inconnue se déroule', () => {
    const known = new Set([a])
    expect(pickTyping(known, [a, b, c], true)).toBe(c)
    expect(pickTyping(known, [a, b, c], true)).toBeNull()
  })
  it('retour dans l’app ou hors ligne : affichage d’un coup', () => {
    const known = new Set([a])
    expect(pickTyping(known, [a, b], false)).toBeNull()
    expect(pickTyping(known, [a, b], true)).toBeNull()
  })
  it('identité stable quelle que soit la position dans la liste', () => {
    expect(replyId({ ts: '2026-09-27T10:00:00Z', text: 'Première réponse' })).toBe(a)
    expect(a).not.toBe(b)
  })
})
