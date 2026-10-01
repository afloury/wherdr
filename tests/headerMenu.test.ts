import { describe, expect, it } from 'vitest'
import { keepsNativeMenu, skipsPress } from '../app/utils/headerMenu'

// Fake node: `own` = simple selectors it matches (`.xterm`, `button`,
// `[role="tab"]`…). `closest` walks up the parents like the DOM.
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

describe('header context menu', () => {
  const header: Node = { own: ['header', '.agent-top'] }

  it('opens on the title and details of a header', () => {
    const title = el(['div', '.agent-title'], header)
    expect(keepsNativeMenu(title)).toBe(false)
    expect(skipsPress(title)).toBe(false)
  })

  it('leaves the native menu to the terminal, the conversation text and the fields', () => {
    expect(keepsNativeMenu(el(['canvas'], { own: ['.xterm'] }))).toBe(true)
    expect(keepsNativeMenu(el(['p'], { own: ['.msg'] }))).toBe(true)
    expect(keepsNativeMenu(el(['input'], header))).toBe(true)
    expect(keepsNativeMenu(el(['div', '[contenteditable="true"]']))).toBe(true)
  })

  it('long press: ignores buttons, tabs and handle, not the plan cell', () => {
    expect(skipsPress(el(['svg'], { own: ['button'], parent: header }))).toBe(true)
    expect(skipsPress(el(['span', '[role="tab"]'], header))).toBe(true)
    expect(skipsPress(el(['svg'], { own: ['span', '.cell-grip', '[role="button"]'], parent: header }))).toBe(true)
    const cell: Node = { own: ['div', '.plan-cell', '[role="button"]'] }
    expect(skipsPress(el(['span', '.plan-cell-title'], { own: ['.plan-cell-head'], parent: cell }))).toBe(false)
  })

  it('without a target: nothing to exclude', () => {
    expect(keepsNativeMenu(null)).toBe(false)
    expect(skipsPress(undefined)).toBe(false)
  })
})
