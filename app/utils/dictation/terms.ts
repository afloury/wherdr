// Pane terms for engines that can be biased toward words (the prompt of a
// context-capable model on the device, `keyterms` for OpenRouter): the names
// a speech model gets wrong — agent, machine, folder, file and identifiers.
// Keep the source text as it is: filtering against an English dictionary
// would drop names, numbers and whole languages before the engine sees them.
// Ported from followcat's buildAsrContext (app/utils/asrContext.ts).

export interface DictationTermsInput {
  agent?: string | null
  machine?: string | null
  name?: string | null
  title?: string | null
  cwd?: string | null
  draft?: string
  files?: (string | null | undefined)[]
  recent?: string[] // conversation messages, oldest first
}

// The prompt budget of a phone-sized model; OpenRouter takes far more, but a
// short list stays relevant. One long source cannot crowd out the others.
const MAX_CHARS = 400
const MAX_TERM = 100
const MAX_RECENT = 3

// A word of free text is a term when it looks like a name rather than plain
// language: an inner capital, a digit, or a code character (`useDraft`,
// `v3`, `herdr-core`, `api.ts`, `src/app`).
const NAMED = /\p{Ll}\p{Lu}|\p{N}|[_./-]\p{L}|\p{L}[_./-]/u
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

function wordsOf(text: string): string[] {
  return text.split(/\s+/).map(w => w.replace(EDGE, '')).filter(w => w.length > 1 && NAMED.test(w))
}

export function dictationTerms(o: DictationTermsInput): string[] {
  const cwd = (o.cwd || '').split('/').filter(Boolean).slice(-2)
  const files = (o.files || []).map(f => (f || '').split('/').filter(Boolean).pop())
  const recent = (o.recent || []).slice(-MAX_RECENT).reverse()
  const sources = [
    o.agent, o.machine, o.name, o.title, ...cwd, ...files,
    ...[o.draft || '', ...recent].flatMap(wordsOf),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  let used = 0
  for (const value of sources) {
    const term = String(value || '').trim().replace(/\s+/g, ' ')
    if (!term || term.length > MAX_TERM) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    if (used + term.length > MAX_CHARS) break
    seen.add(key)
    out.push(term)
    used += term.length
  }
  return out
}
