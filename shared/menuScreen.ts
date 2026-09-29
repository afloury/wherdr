// Menus interactifs plein écran de Claude Code (/resume, /model, /mcp, /hooks,
// /permissions…) : un panneau ouvert sous une ligne « ▔▔▔ », qui finit par une
// légende de touches (parfois sur deux lignes) :
//
//   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
//      Resume session
//      ╭─────────────────────────────────────────────────────────╮
//      │ ⌕ Search…                                               │
//      ╰─────────────────────────────────────────────────────────╯
//        demo                                    ← en-tête (gris)
//      ❯ Beta                                    ← curseur
//        3 seconds ago · HEAD · 244.3KB          ← description (gris)
//        Alpha
//        19 seconds ago · HEAD · 245.7KB
//        Ctrl+A to show all projects · Space to preview · Type
//        to search · Esc to cancel
//
// Libellés et descriptions sont à la même colonne : seule la couleur les
// distingue. Le texte lu peut donc être en ANSI : une ligne entièrement dans la
// couleur de la légende (gris) ou en SGR 2 est une description (ou un en-tête
// si aucune entrée ne la précède), une ligne entièrement en gras un en-tête.
// Sans ANSI, toutes les lignes alignées sur le curseur sont des entrées.
import type { InteractiveMenu, MenuEntry, WaitAction } from './types'

// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[([0-9;]*)m/g
// eslint-disable-next-line no-control-regex
const OTHER_ESC = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const TOP = /^\s*▔{8,}\s*$/
const BOX = /^\s*[╭╰│]/
const MORE = /^(?:[↑↓]\s*)?\d+\s+more\b.*$|^…\s*\+?\d+/
// Segment de légende : « Ctrl+A to show all projects », « Esc to cancel »,
// « ↑/↓ to navigate », « s to use this session only », « Type to search ».
const SEG = /^(ctrl\+\w|shift\+tab|esc|escape|enter|return|space|tab|type|[a-z0-9]|[↑↓←→](?:\s*\/\s*[↑↓←→])*)\s+to\s+(\S.*)$/i

interface Styled { text: string, dim: boolean[], bold: boolean[], fg: (string | null)[] }

// Ligne ANSI → texte et style de chaque caractère.
function styled(raw: string): Styled {
  const s = raw.replace(OTHER_ESC, m => (m.endsWith('m') && m.startsWith('\x1b[') ? m : ''))
  const out: Styled = { text: '', dim: [], bold: [], fg: [] }
  let fg: string | null = null
  let dim = false
  let bold = false
  let last = 0
  const push = (chunk: string) => {
    for (const ch of chunk) {
      out.text += ch
      out.dim.push(dim)
      out.bold.push(bold)
      out.fg.push(fg)
    }
  }
  for (const m of s.matchAll(SGR)) {
    push(s.slice(last, m.index))
    last = m.index! + m[0].length
    const codes = (m[1] || '0').split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!
      if (c === 0) { fg = null; dim = false; bold = false }
      else if (c === 1) bold = true
      else if (c === 2) dim = true
      else if (c === 22) { bold = false; dim = false }
      else if (c === 39) fg = null
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) fg = String(c)
      else if (c === 38 && codes[i + 1] === 2) { fg = codes.slice(i + 2, i + 5).join(','); i += 4 }
      else if (c === 38 && codes[i + 1] === 5) { fg = `5:${codes[i + 2]}`; i += 2 }
      else if (c === 48 && codes[i + 1] === 2) i += 4
      else if (c === 48 && codes[i + 1] === 5) i += 2
    }
  }
  push(s.slice(last))
  out.text = out.text.replace(/\s+$/, '')
  return out
}

// Colonne où commence le texte, après le curseur « ❯ » ou une flèche de défilement.
function textColumn(t: string): number {
  return t.match(/^\s*(?:[❯↑↓]\s+)?/)![0].length
}

// Tous les caractères visibles à partir de `from` ont le style testé.
function all(l: Styled, from: number, test: (i: number) => boolean): boolean {
  let any = false
  for (let i = from; i < l.text.length; i++) {
    if (!l.text[i]!.trim()) continue
    if (!test(i)) return false
    any = true
  }
  return any
}

// « Ctrl+A » → « ctrl+a », « Esc » → « esc »… ; null : pas une touche à proposer.
function keyName(k: string): string | null {
  const s = k.toLowerCase().replace(/\s+/g, '')
  if (s === 'escape') return 'esc'
  if (s === 'return') return 'enter'
  if (/^(?:ctrl\+\w|shift\+tab|esc|enter|space|tab|[a-z0-9])$/.test(s)) return s
  return null
}

// Légende (lignes jointes) → actions ; null si ce n'en est pas une.
function parseLegend(text: string): { actions: WaitAction[], search: boolean } | null {
  const segs = text.trim().split(/\s+·\s+/).filter(Boolean)
  if (!segs.length) return null
  const actions: WaitAction[] = []
  let search = false
  for (const seg of segs) {
    const m = seg.match(SEG)
    if (!m) return null
    const k = m[1]!
    const label = m[2]!.trim()
    if (/^type$/i.test(k)) { search = true; continue }
    if (/^[←→]/.test(k) && k.includes('/')) {
      actions.push({ key: 'left', label: `← ${label}` }, { key: 'right', label: `→ ${label}` })
      continue
    }
    const key = keyName(k)
    // Renommer ouvre un champ dans la liste : à faire dans le terminal.
    if (!key || /\brename\b/i.test(label)) continue
    actions.push({ key, label })
  }
  return { actions, search }
}

export function parseMenu(text: string | null | undefined): InteractiveMenu | null {
  if (!text) return null
  const rows = String(text).replace(/\s+$/, '').split('\n').slice(-80).map(styled)
  let top = -1
  for (let i = rows.length - 1; i >= 0; i--) if (TOP.test(rows[i]!.text)) { top = i; break }
  if (top < 0) return null
  const region = rows.slice(top + 1)
  while (region.length && !region[region.length - 1]!.text.trim()) region.pop()
  if (!region.length) return null

  // Légende : dernière ligne, et celles d'au-dessus tant que l'ensemble en est une (légende repliée).
  const joined = (from: number) => parseLegend(region.slice(from).map(r => r.text.trim()).join(' '))
  let legendAt = -1
  let legend: ReturnType<typeof parseLegend> = null
  for (let i = region.length - 1; i >= Math.max(0, region.length - 4) && region[i]!.text.trim(); i--) {
    const l = joined(i)
    if (l) { legend = l; legendAt = i } else if (legend) break
  }
  if (!legend) return null
  // Un menu se ferme avec Échap ; sans cela (écran d'attente, invite), ce n'est pas un menu.
  if (!/(?:^|·\s*)(?:esc|escape)\s+to\b/i.test(region.slice(legendAt).map(r => r.text.trim()).join(' '))) return null
  const legendRow = region[legendAt]!
  const hintFg = legendRow.fg[textColumn(legendRow.text)] ?? null
  const isDim = (l: Styled, from: number) => all(l, from, i => l.dim[i]! || (hintFg !== null && l.fg[i] === hintFg))
  const isBold = (l: Styled, from: number) => all(l, from, i => l.bold[i]!)

  const body = region.slice(0, legendAt)
  let first = body.findIndex(r => r.text.trim())
  const titleRow = first >= 0 ? body[first]!.text.trim() : ''
  const title = titleRow ? titleRow.split(/\s{2,}/)[0]!.slice(0, 120) : null

  // Champ de recherche : « │ ⌕ Search… │ » (vide) ou « │ ⌕ texte │ ».
  let search: string | null = null
  let afterBox = first + 1
  let boxAt = -1
  body.forEach((r, i) => {
    const m = r.text.match(/⌕\s?(.*?)\s*│?\s*$/)
    if (!m) return
    search = /^Search…?$/.test(m[1]!.trim()) ? '' : m[1]!.trim()
    boxAt = i - 1
    afterBox = Math.max(afterBox, i + 2)
  })
  if (search === null && legend.search) search = ''

  let cursorRow = -1
  for (let i = body.length - 1; i > first; i--) if (/^\s*❯\s/.test(body[i]!.text)) { cursorRow = i; break }

  const items: (MenuEntry & { row: number, start: number })[] = []
  let more: string | null = null
  if (cursorRow >= 0) {
    const col = textColumn(body[cursorRow]!.text)
    for (let i = afterBox; i < body.length; i++) {
      const r = body[i]!
      const t = r.text.trim()
      if (!t || BOX.test(r.text)) continue
      const c = textColumn(r.text)
      const content = r.text.slice(c)
      if (MORE.test(content.trim())) { more = content.trim().replace(/^[↑↓]\s*/, ''); continue }
      const prev = items[items.length - 1]
      if (c > col && prev && prev.row === i - 1 && !prev.header) {
        prev.hint = [prev.hint, content.trim()].filter(Boolean).join(' · ')
        prev.row = i
        continue
      }
      if (c !== col) continue
      const cursor = i === cursorRow
      if (!cursor && isDim(r, c)) {
        // Description de l'entrée juste au-dessus, sinon en-tête de groupe.
        if (prev && !prev.header && prev.row === i - 1) {
          prev.hint = [prev.hint, content.trim()].filter(Boolean).join(' · ')
          prev.row = i
        } else items.push({ label: content.trim(), hint: null, header: true, row: i, start: i })
        continue
      }
      if (!cursor && isBold(r, c)) { items.push({ label: content.trim(), hint: null, header: true, row: i, start: i }); continue }
      // « 5.  Haiku 4.5 ✔            Fastest for quick answers » : numéro retiré, colonnes en description.
      const parts = content.replace(/^\d{1,2}\.\s+/, '').split(/\s{2,}/)
      items.push({ label: parts[0]!.trim(), hint: parts.slice(1).join(' · ').trim() || null, row: i, start: i, ...(cursor ? { cursor: true } : {}) })
    }
  }
  // Lignes d'explication entre le titre et la liste (repliées par le terminal) : une seule ligne.
  const listTop = Math.min(boxAt >= 0 ? boxAt : body.length, items.length ? items[0]!.start : body.length)
  const intro: string[] = []
  for (let i = first + 1; i < listTop; i++) {
    const t = body[i]!.text.trim()
    if (t && !BOX.test(body[i]!.text) && intro.length < 4) intro.push(t)
  }
  first = items.findIndex(it => it.cursor)
  return {
    title,
    lines: intro.length ? [intro.join(' ').slice(0, 400)] : [],
    items: items.slice(0, 40).map(({ row: _row, start: _start, ...it }) => ({ ...it, label: it.label.slice(0, 200), hint: it.hint ? it.hint.slice(0, 200) : null })),
    cursor: first >= 0 && first < 40 ? first : null,
    search,
    actions: legend.actions,
    more,
  }
}

// Touches pour aller de l'entrée `from` à l'entrée `to` : une flèche à la fois,
// l'écran relu entre deux (les en-têtes ne prennent pas le curseur).
export function stepToward(menu: InteractiveMenu, to: number): 'up' | 'down' | 'enter' | null {
  if (menu.cursor === null || !menu.items[to] || menu.items[to]!.header) return null
  if (to === menu.cursor) return 'enter'
  return to > menu.cursor ? 'down' : 'up'
}

// Retrouve une entrée par son libellé (et son rang parmi les homonymes).
export function findEntry(menu: InteractiveMenu, index: number, label: string): number {
  if (menu.items[index]?.label === label) return index
  return menu.items.findIndex(it => !it.header && it.label === label)
}

// Touches pour taper `text` dans le champ de recherche (lettre par lettre : un
// collage n'y est pas pris), après avoir effacé `current`.
export function searchKeys(current: string, text: string): string[] {
  const keys: string[] = []
  for (let i = 0; i < [...current].length; i++) keys.push('backspace')
  for (const ch of text) keys.push(ch === ' ' ? 'space' : ch)
  return keys
}
