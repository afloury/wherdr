import { describe, expect, it } from 'vitest'
import { keepsNativeMenu, skipsPress } from '../app/utils/headerMenu'

// Nœud factice : `own` = sélecteurs simples qu'il vérifie (`.xterm`, `button`,
// `[role="tab"]`…). `closest` remonte les parents comme le DOM.
interface Node { own: string[], parent?: Node }
function el(own: string[], parent?: Node) {
  const node: Node = { own, parent }
  const hit = (n: Node, sel: string) => {
    const [base, neg] = sel.split(':not(')
    return n.own.includes(base!.trim()) && !(neg && n.own.includes(neg.replace(')', '').trim()))
  }
  return {
    closest(list: string) {
      for (let n: Node | undefined = node; n; n = n.parent) {
        if (list.split(',').some(s => hit(n!, s.trim()))) return n
      }
      return null
    },
  }
}

describe('menu contextuel des en-têtes', () => {
  const header: Node = { own: ['header', '.agent-top'] }

  it('s’ouvre sur le titre et les détails d’un en-tête', () => {
    const title = el(['div', '.agent-title'], header)
    expect(keepsNativeMenu(title)).toBe(false)
    expect(skipsPress(title)).toBe(false)
  })

  it('laisse le menu natif au terminal, au texte de la conversation et aux champs', () => {
    expect(keepsNativeMenu(el(['canvas'], { own: ['.xterm'] }))).toBe(true)
    expect(keepsNativeMenu(el(['p'], { own: ['.msg'] }))).toBe(true)
    expect(keepsNativeMenu(el(['input'], header))).toBe(true)
    expect(keepsNativeMenu(el(['div', '[contenteditable="true"]']))).toBe(true)
  })

  it('appui long : ignore boutons, onglets et poignée, pas la case du plan', () => {
    expect(skipsPress(el(['svg'], { own: ['button'], parent: header }))).toBe(true)
    expect(skipsPress(el(['span', '[role="tab"]'], header))).toBe(true)
    expect(skipsPress(el(['svg'], { own: ['span', '.cell-grip', '[role="button"]'], parent: header }))).toBe(true)
    const cell: Node = { own: ['div', '.plan-cell', '[role="button"]'] }
    expect(skipsPress(el(['span', '.plan-cell-title'], { own: ['.plan-cell-head'], parent: cell }))).toBe(false)
  })

  it('sans cible : rien à exclure', () => {
    expect(keepsNativeMenu(null)).toBe(false)
    expect(skipsPress(undefined)).toBe(false)
  })
})
