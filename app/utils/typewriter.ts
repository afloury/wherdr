// Effet machine à écrire des nouvelles réponses de l'agent (Conversation).
// Claude Code et Codex n'écrivent une réponse qu'une fois finie : on la
// déroule côté app. Pour garder un markdown toujours correct, on ne tronque
// jamais le source : on rend le HTML final (utils/markdown.ts), puis on révèle
// ses nœuds texte dans l'ordre du document. Un élément dont le texte n'a pas
// commencé est masqué (`hidden`) ; les balises ne peuvent donc pas être
// cassées, et blocs de code ou tableaux se remplissent dans leur cadre final.
// Les fonctions travaillent sur une interface minimale de nœud (DOM réel dans
// l'app, objets simples dans les tests).

export interface RevealNode {
  nodeType: number
  nodeValue: string | null
  childNodes: ArrayLike<RevealNode>
  hidden?: boolean
}

interface TextEntry { node: RevealNode, full: string, start: number }
interface ElemEntry { node: RevealNode, start: number, text: boolean, keep: boolean }
export interface RevealPlan {
  texts: TextEntry[]
  elems: ElemEntry[]
  total: number
  stops: number[]
  shown: number
  written: number
}

// Paramètres du déroulé : cadence d'écriture, distance entre les deux fronts,
// durée du rattrapage et vitesse de changement des glyphes.
export const TYPE_MIN_MS = 500
export const TYPE_MAX_MS = 2000
export type TypingSpeed = 'off' | 'fast' | 'medium' | 'slow'
export const TYPE_FACTOR: Record<Exclude<TypingSpeed, 'off'>, number> = { fast: 1, medium: 2, slow: 3 }
export const CIPHER_GAP: Record<Exclude<TypingSpeed, 'off'>, number> = { fast: 20, medium: 40, slow: 70 }
export const CATCHUP_MS: Record<Exclude<TypingSpeed, 'off'>, number> = { fast: 300, medium: 450, slow: 650 }
export const GLYPH_MS = 60
export function typeDuration(chars: number, speed: TypingSpeed = 'fast'): number {
  if (speed === 'off') return 0
  return Math.round(Math.min(TYPE_MAX_MS, Math.max(TYPE_MIN_MS, 400 + chars * 3.5)) * TYPE_FACTOR[speed])
}

export interface TypingFronts { written: number, decrypted: number, done: boolean }
export function typingFronts(total: number, elapsed: number, speed: TypingSpeed): TypingFronts {
  if (speed === 'off' || total <= 0) return { written: total, decrypted: total, done: true }
  const duration = typeDuration(total, speed)
  const written = Math.min(total, Math.floor(Math.max(0, elapsed) / duration * total))
  const gap = Math.min(total, CIPHER_GAP[speed])
  const behind = Math.max(0, written - gap)
  const catchup = Math.min(1, Math.max(0, elapsed - duration) / CATCHUP_MS[speed])
  const decrypted = Math.min(total, behind + Math.floor((total - behind) * catchup))
  return { written, decrypted, done: elapsed >= duration + CATCHUP_MS[speed] }
}

// Points d'arrêt : fin de chaque mot (espaces compris) ; un mot très long
// (URL, chemin, ligne de code) avance par groupes de 8 caractères.
export function wordStops(text: string, maxWord = 8): number[] {
  const stops: number[] = []
  const re = /\s*\S+\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    for (let p = m.index + maxWord; p < end - 2; p += maxWord) stops.push(p)
    stops.push(end)
  }
  if (!stops.length || stops[stops.length - 1] !== text.length) stops.push(text.length)
  return stops
}

// Caractères visibles après `elapsed` ms.
export function revealedAt(stops: number[], elapsed: number, duration: number): number {
  if (!stops.length) return 0
  if (elapsed >= duration) return stops[stops.length - 1]!
  const i = Math.floor(Math.max(0, elapsed) / duration * stops.length)
  return i <= 0 ? 0 : stops[Math.min(i, stops.length) - 1]!
}

// Relevé du contenu : nœuds texte (hors blancs de mise en page) avec leur
// position dans le texte révélé, éléments avec la position de leur début.
// `atomic(el)` : élément montré d'un bloc (en-tête des blocs de code) ;
// `keep(el)` : jamais masqué, seulement vide (cellules : la ligne d'un tableau
// garde ses colonnes).
export interface PlanOptions { atomic?: (n: RevealNode) => boolean, keep?: (n: RevealNode) => boolean }
export function planReveal(root: RevealNode, { atomic = () => false, keep = () => false }: PlanOptions = {}): RevealPlan {
  const texts: TextEntry[] = []
  const elems: ElemEntry[] = []
  let pos = 0
  let flat = ''
  const walk = (n: RevealNode) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) {
        const full = c.nodeValue || ''
        if (!full.trim()) continue
        texts.push({ node: c, full, start: pos })
        pos += full.length
        flat += full
      } else if (c.nodeType === 1) {
        const e: ElemEntry = { node: c, start: pos, text: false, keep: keep(c) }
        elems.push(e)
        if (!atomic(c)) walk(c)
        e.text = pos > e.start
      }
    }
  }
  walk(root)
  return { texts, elems, total: pos, stops: wordStops(flat), shown: -1, written: -1 }
}

// Montre les `n` premiers caractères. Élément avec du texte : masqué tant que
// ce texte n'a pas commencé ; sans texte (image, trait, en-tête atomique) :
// montré dès que ce qui le précède est écrit. `trail` : la traîne chiffrée
// suit (mode Terminal) ; l'élément qui commence juste à `n` est alors montré
// pour la porter (nouveau paragraphe qui s'ouvre sur des glyphes).
export function applyReveal(plan: RevealPlan, n: number, trail = false, written = n) {
  if (n === plan.shown && written === plan.written) return
  plan.shown = n
  plan.written = written
  for (const t of plan.texts) {
    const v = t.full.slice(0, Math.max(0, n - t.start))
    if (t.node.nodeValue !== v) t.node.nodeValue = v
  }
  const edge = trail && written < plan.total ? written + 1 : written
  for (const e of plan.elems) {
    const hide = !e.keep && written < plan.total && (e.text ? e.start >= edge : e.start > written)
    if (Boolean(e.node.hidden) !== hide) e.node.hidden = hide
  }
}

// ------------------------------------------------------------ bande chiffrée
// Chaque portion conserve ses vrais caractères dans le flux, sous les glyphes
// peints en CSS. Une bande peut traverser plusieurs nœuds Markdown.
export const TRAIL_GLYPHS = '#%@&$*+=-/\\|<>01{}[]~^:;_!?'

// Les anciens choix retrouvent leur cadence d'origine. Un nouvel appareil
// commence en Moyenne, avec le texte chiffré activé.
export function parseTypingSettings(speed: string | null, encrypted: string | null, oldMode: string | null, oldSwitch: string | null): { speed: TypingSpeed, encrypted: boolean } {
  const migrated = oldMode === 'off' || oldSwitch === '0' ? 'off' : oldMode === 'plain' || oldMode === 'terminal' ? 'fast' : 'medium'
  return {
    speed: speed === 'off' || speed === 'fast' || speed === 'medium' || speed === 'slow' ? speed : migrated,
    encrypted: encrypted === '0' ? false : encrypted === '1' ? true : oldMode !== 'plain',
  }
}
export const effectiveTypingSpeed = (speed: TypingSpeed, reducedMotion: boolean): TypingSpeed => (reducedMotion ? 'off' : speed)
export const encryptedTextActive = (speed: TypingSpeed, encrypted: boolean, reducedMotion: boolean): boolean =>
  effectiveTypingSpeed(speed, reducedMotion) !== 'off' && encrypted
export interface CipherSegment { node: RevealNode, text: string }
export function cipherSegments(plan: RevealPlan, decrypted: number, written: number): CipherSegment[] {
  if (written <= decrypted) return []
  const segments: CipherSegment[] = []
  for (const t of plan.texts) {
    if (t.start >= written) break
    const from = Math.max(0, decrypted - t.start)
    const to = Math.min(t.full.length, written - t.start)
    if (to > from) segments.push({ node: t.node, text: t.full.slice(from, to) })
  }
  return segments
}

// Un glyphe par caractère ; les blancs restent des blancs (coupures de ligne
// et indentation des blocs de code intactes).
export function trailGlyphs(text: string, rand: () => number = Math.random): string[] {
  return Array.from(text, c => (/\s/.test(c) ? c : TRAIL_GLYPHS[Math.floor(rand() * TRAIL_GLYPHS.length)]!))
}

// Remet tout le contenu (fin, ou toucher le message).
export function finishReveal(plan: RevealPlan) {
  applyReveal(plan, plan.total)
}

// Identité d'une réponse, stable quand des tranches plus anciennes s'ajoutent
// au-dessus (la clé de bloc, elle, contient la position dans la liste).
export const replyId = (it: { ts: string | null, text: string }) => `${it.ts || ''}|${it.text.length}|${it.text.slice(0, 64)}`

// Réponse à dérouler après une relecture : seulement la dernière réponse
// inconnue, et seulement si la conversation était déjà affichée et suivie en
// direct (pas au premier chargement, au retour dans l'app ni hors ligne).
// Toutes les réponses reçues deviennent connues.
export function pickTyping(known: Set<string>, replies: string[], live: boolean): string | null {
  let pick: string | null = null
  for (const id of replies) {
    if (!known.has(id)) {
      known.add(id)
      pick = id
    }
  }
  return live ? pick : null
}
