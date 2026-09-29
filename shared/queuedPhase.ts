// Message « en attente » de wherdr face à l'écran de Claude (ClaudeScreen) :
// encore dans sa file, déjà parti (tour en cours), ou commande « ! » en cours
// d'exécution. La transcription ne le dit qu'après coup (une commande « ! »
// n'y est écrite qu'à la fin), l'écran tout de suite.
import type { ClaudeScreen } from './types'
import { dropReplyMarker } from './replyQuote'

export type QueuedPhase = 'queued' | 'sent' | 'running'

const UPLOAD = '/.cache/herdr-web/uploads/'
// L'écran remplace les photos par « [Image #1] » et coupe les longues lignes.
const norm = (t: string) => dropReplyMarker(String(t || '').replace(/\[Image #\d+\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
const msgNorm = (t: string) => norm(String(t || '').split('\n').filter(l => !l.includes(UPLOAD)).join('\n'))

// Même message (80 premiers caractères) ; ou l'un commence par l'autre, assez
// long pour ne pas confondre « ok » et « ok, vas-y » (écran coupé).
function same(a: string, b: string): boolean {
  const x = a.slice(0, 80)
  const y = b.slice(0, 80)
  if (!x || !y) return false
  return x === y || (Math.min(x.length, y.length) >= 24 && (x.startsWith(y) || y.startsWith(x)))
}

const isBash = (t: string) => /^\s*!/.test(t)
const bashNorm = (t: string) => norm(String(t || '').replace(/^\s*!\s*/, ''))

export function queuedPhase(text: string, s: ClaudeScreen | null | undefined): QueuedPhase {
  if (!s) return 'queued'
  const n = msgNorm(text)
  if (!n) return 'queued'
  if (s.queued.some(q => same(n, norm(q)))) return 'queued'
  if (isBash(text)) {
    if (s.shell && same(bashNorm(text), norm(s.shell.command))) return 'running'
    return s.sent && isBash(s.sent) && same(bashNorm(text), bashNorm(s.sent)) ? 'sent' : 'queued'
  }
  return s.sent && !isBash(s.sent) && same(n, norm(s.sent)) ? 'sent' : 'queued'
}
