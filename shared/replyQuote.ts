// Réponse à un message précis de l'agent : le message envoyé commence par un
// repère court (heure + début du message ou passage choisi), jamais par le
// message entier : l'agent a déjà toute la conversation dans son contexte.
//   ↳ En réponse à ton message de 14:32 (« Je propose deux options : … »)
//   <ligne vide>
//   la réponse
// À l'affichage, ce repère devient un petit encadré de citation cliquable.

export interface ReplyTarget {
  time: string // heure affichée du message d'origine (« 14:32 »)
  excerpt: string // extrait lisible, déjà tronqué
}

// Longueur maximale du repère entier (ligne « ↳ … »).
export const MARKER_MAX = 120

// Texte lisible d'un message markdown : sans balises de code, liens, titres,
// emphases, et sur une seule ligne.
export function plainText(md: string): string {
  return String(md || '')
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|\*|_|`|~~)/g, '')
    .replace(/[«»“”"]/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

// Coupe à `max` caractères au plus, sur une fin de mot si possible, avec « … ».
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, Math.max(1, max - 1))
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`
}

function head(lang: 'fr' | 'en', time: string) {
  return lang === 'en' ? `↳ Replying to your message from ${time} (` : `↳ En réponse à ton message de ${time} (`
}
const open = (lang: 'fr' | 'en') => (lang === 'en' ? '"' : '« ')
const close = (lang: 'fr' | 'en') => (lang === 'en' ? '")' : ' »)')

// Cible d'une réponse : extrait du passage choisi, sinon du début du message,
// assez court pour que le repère entier tienne dans MARKER_MAX.
export function replyTarget(message: string, time: string, lang: 'fr' | 'en', selection?: string): ReplyTarget {
  const room = MARKER_MAX - head(lang, time).length - open(lang).length - close(lang).length
  const src = plainText(selection && selection.trim() ? selection : message)
  return { time, excerpt: truncate(src, Math.max(20, room)) }
}

export function replyMarker(r: ReplyTarget, lang: 'fr' | 'en'): string {
  return `${head(lang, r.time)}${open(lang)}${r.excerpt}${close(lang)}`
}

// Message envoyé : repère + ligne vide + réponse.
export function withReply(r: ReplyTarget | null | undefined, body: string, lang: 'fr' | 'en'): string {
  if (!r || !body) return body
  return `${replyMarker(r, lang)}\n\n${body}`
}

// Les deux langues sont reconnues (la langue de l'app a pu changer depuis).
const MARKER_RE = /^↳ (?:En réponse à ton message de|Replying to your message from) (\d{1,2}[:h.]\d{2}(?:\s?[AaPp][Mm])?) \((?:« (.*) »|"(.*)")\)[ \t]*(?:\r?\n|$)/

// Message de l'utilisateur qui commence par un repère : citation + corps.
export function parseReply(text: string): { reply: ReplyTarget, body: string } | null {
  const m = MARKER_RE.exec(String(text || ''))
  if (!m) return null
  const excerpt = m[2] ?? m[3] ?? ''
  return { reply: { time: m[1]!, excerpt }, body: text.slice(m[0].length).replace(/^\s*\n/, '').trim() }
}

const norm = (s: string) => plainText(s).toLowerCase()

// Message d'origine d'une citation, parmi les réponses de l'agent affichées :
// même heure et texte qui contient l'extrait ; à défaut l'extrait seul, puis
// l'heure seule. Le plus récent avant la réponse (index `before`) l'emporte.
export function findReplyOrigin<T extends { time: string | null, text: string }>(list: T[], r: ReplyTarget, before = list.length): T | null {
  const bit = norm(r.excerpt.replace(/…$/, '')).slice(0, 60)
  const cands = list.slice(0, before).reverse()
  const hasBit = (x: T) => Boolean(bit) && norm(x.text).includes(bit)
  return cands.find(x => x.time === r.time && hasBit(x))
    || cands.find(hasBit)
    || cands.find(x => x.time === r.time)
    || null
}

// Texte déjà normalisé (une ligne, minuscules) sans son repère : deux réponses
// au même message ne se confondent pas dans la file d'attente.
export function dropReplyMarker(normed: string): string {
  return normed.replace(/^↳ (?:en réponse à ton message de|replying to your message from) .*?(?: »|")\)\s*/i, '')
}
