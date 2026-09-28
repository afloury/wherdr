// Lecture des invites bloquantes des agents (validation d'outil, AskUserQuestion,
// confiance du dossier…) à partir du texte « detection » de Herdr, pour les
// proposer en boutons sur le téléphone.
//
// Deux formes rencontrées chez Claude Code :
//
//   Quelle est ta couleur préférée ?          Security guide
//
//   ❯ 1. Rouge                                ❯ No, exit
//        La couleur rouge                       Yes, I trust this folder
//     2. Vert
//        La couleur verte                     Enter to confirm · Esc to cancel
//
// Le curseur ❯ marque l'option sélectionnée. On y répond en déplaçant le
// curseur (↑/↓) puis Entrée, ce qui marche pour les deux formes.
import type { Choices } from '../../shared/types'
import { isPermissionQuestion, screenDetail } from './promptDetail'

// ❯ chez Claude Code, › chez Codex ; > sur l'écran de connexion de Codex, pris
// seulement devant une option numérotée (sinon une citation « > … » compterait).
const CURSOR = /^(\s*)(?:[❯›]|>(?=\s+\d{1,2}\.\s))\s+(\S.*?)\s*$/
const NUMBERED = /^(\s*)(?:[❯›>]\s+)?(\d{1,2})\.\s+(\S.*?)\s*$/
const RULE = /^[\s─━═—-]+$/
// Début d'une colonne voisine : au moins 3 espaces ou un trait vertical │.
const GAP = /\S(?: {3,}| *│ *)(?=\S)/g

// Colonnes où reprend du texte après un écart, sur une ligne.
function gapColumns(line: string): number[] {
  const cols: number[] = []
  for (const m of line.matchAll(GAP)) {
    const bar = m[0].indexOf('│')
    cols.push(m.index! + (bar >= 0 ? bar : m[0].length))
  }
  return cols
}

// Claude Code peut afficher un panneau à droite de la boîte de dialogue (vue
// diff « N files changed ») : chaque ligne de l'écran porte alors les deux
// colonnes. La colonne voisine se reconnaît à un écart sur une ligne de texte
// hors options (la question), à la même position qu'un blanc suivi de texte
// sur la ligne du curseur ; les descriptions alignées d'une liste (/model)
// n'apparaissent que sur les lignes d'options. On coupe alors l'écran à cette
// colonne.
function dropSidePanel(lines: string[], c: number): string[] {
  const cursor = lines[c]!
  const splitsCursor = (x: number) => x < cursor.length && /[\s│]/.test(cursor[x - 1]!) && /\S/.test(cursor[x]!)
  // Seules les deux lignes de texte juste au-dessus des options comptent :
  // plus haut, un en-tête encadré (Codex) peut s'aligner par hasard.
  let split = -1
  let seen = 0
  for (let i = c - 1; i >= Math.max(0, c - 40) && split < 0 && seen < 2; i--) {
    const line = lines[i]!
    if (!line.trim() || NUMBERED.test(line) || CURSOR.test(line)) continue
    seen++
    split = gapColumns(line).find(splitsCursor) ?? -1
  }
  if (split < 0) return lines
  return lines.map((line) => {
    if (line.length <= split || !/[\s│]/.test(line[split - 1]!)) return line
    return line.slice(0, split).replace(/[\s│]+$/, '')
  })
}

// Colonne (en caractères) où commence le texte d'une ligne d'option.
function textColumn(line: string): number {
  const m = line.match(/^(\s*)(?:(?:[❯›]|>(?=\s+\d))\s+)?/)
  return m ? m[0].length : 0
}

interface RawOption { n: number | null, label: string, hint: string | null, line: number }

// `strict` : n'accepter que les listes numérotées. Utilisé quand Herdr ne voit
// pas l'agent comme bloqué (l'écran de confiance de Codex passe pour « idle ») :
// une liste non numérotée pourrait alors n'être que le champ de saisie
// (« › Ask Codex… » suivi de la ligne du modèle, alignée pareil).
export function parseChoices(text: string | null | undefined, { strict = false }: { strict?: boolean } = {}): Choices | null {
  if (!text) return null
  let lines = text.replace(/\s+$/, '').split('\n').slice(-60)

  // Le dernier ❯ de l'écran : les précédents sont l'historique (prompts
  // envoyés), l'invite active est toujours en bas.
  let c = -1
  for (let i = lines.length - 1; i >= 0; i--) if (CURSOR.test(lines[i]!)) { c = i; break }
  if (c < 0) return null
  lines = dropSidePanel(lines, c)

  const cursorLine = lines[c]!
  const col = textColumn(cursorLine)
  const cursorText = cursorLine.match(CURSOR)![2]!
  const options: RawOption[] = []

  if (/^\d{1,2}\.\s/.test(cursorText)) {
    // Options numérotées : on prend toutes celles alignées sur la même colonne,
    // de part et d'autre du curseur (un séparateur ─── peut les couper).
    let first = c
    for (let i = c - 1; i >= Math.max(0, c - 40); i--) {
      const m = lines[i]!.match(NUMBERED)
      if (m && textColumn(lines[i]!) === col) first = i
    }
    for (let i = first; i < lines.length; i++) {
      const line = lines[i]!
      const m = line.match(NUMBERED)
      if (m && textColumn(line) === col) {
        options.push({ n: Number(m[2]), label: m[3]!, hint: null, line: i })
      } else if (options.length && line.trim() && !RULE.test(line) && textColumn(line) > col) {
        // Ligne plus indentée juste sous une option : sa description.
        const o = options[options.length - 1]!
        if (!o.hint && i === o.line + 1) o.hint = line.trim()
      }
    }
    // Garde-fou : une vraie liste est numérotée 1, 2, 3… sans trou.
    for (let i = 0; i < options.length; i++) if (options[i]!.n !== i + 1) return null
  } else {
    if (strict) return null
    // Options sans numéro : lignes contiguës au curseur, même colonne de texte.
    const sameCol = (l: string) => Boolean(l.trim()) && !RULE.test(l) && !/^\s*[❯›]/.test(l) && textColumn(l) === col
    let first = c
    while (first - 1 >= 0 && sameCol(lines[first - 1]!)) first--
    let last = c
    while (last + 1 < lines.length && sameCol(lines[last + 1]!)) last++
    for (let i = first; i <= last; i++) {
      const label = i === c ? cursorText : lines[i]!.trim()
      options.push({ n: null, label, hint: null, line: i })
    }
  }

  if (options.length < 2 || options.length > 12) return null
  const cursor = options.findIndex(o => o.line === c)
  if (cursor < 0) return null

  // La question : la ligne non vide la plus proche au-dessus des options,
  // de préférence celle qui se termine par « ? ».
  // À défaut, une ligne qui contient un « ? », puis la plus proche.
  let question: { t: string, i: number } | null = null
  let asks: { t: string, i: number } | null = null
  let nearest: { t: string, i: number } | null = null
  const top = options[0]!.line
  for (let i = top - 1; i >= Math.max(0, top - 12); i--) {
    const t = lines[i]!.trim()
    if (!t || RULE.test(t)) continue
    if (/\?\s*$/.test(t)) { question = { t, i }; break }
    if (!asks && t.includes('?')) asks = { t, i }
    if (!nearest) nearest = { t, i }
  }
  question = question || asks || nearest

  const out: Choices = {
    question: question ? question.t.replace(/^[☐☒✔●◆▸•\s]+/, '').slice(0, 300) : null,
    cursor,
    options: options.map(o => ({ label: o.label.slice(0, 200), hint: o.hint ? o.hint.slice(0, 200) : null })),
  }
  // Demande de permission : ce qui est demandé (outil, commande, fichier).
  if (question && isPermissionQuestion(out.question)) {
    const detail = screenDetail(lines, question.i, top)
    if (detail) out.detail = detail
  }
  return out
}

// Touches à envoyer pour choisir l'option `index` quand le curseur est sur `cursor`.
export function keysFor(choices: Choices, index: number): string[] {
  const d = index - choices.cursor
  const keys: string[] = []
  for (let i = 0; i < Math.abs(d); i++) keys.push(d > 0 ? 'down' : 'up')
  keys.push('enter')
  return keys
}

// Champ de saisie visible = une ligne « ❯ » (Claude) ou « › » (Codex) en bas de
// l'écran. Certaines commandes (/usage, /context all…) ouvrent un panneau plein
// écran qui le cache tant qu'on n'appuie pas sur Échap.
export function inputVisible(text: string | null | undefined): boolean {
  const lines = String(text || '').replace(/\s+$/, '').split('\n').slice(-12)
  return lines.some(l => /^\s*[❯›](\s|$)/.test(l))
}
