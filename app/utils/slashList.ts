// The composer's "/" list: which commands and skills answer what is typed, in what order, and
// what a key does while the list is open. Pure: Composer.vue draws it and applies the keys.
import type { SlashCommand } from '#shared/slashCommands'

// What follows the "/" when the field holds only that one word, else null: the list is for a
// command being typed, not for a message that goes on, or starts with a path ("/srv/app/x").
export function slashToken(text: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(text)
  return m ? m[1]! : null
}

export interface SlashMatch {
  cmd: SlashCommand
  // 0 the name (or an alias), 1 starts with it, 2 a word of the name does ("ret" in
  // "skill:retro"), 3 the name has it inside, 4 only the description does.
  tier: number
  // Typed as written: nothing left to complete.
  exact: boolean
}

// Tiers up to this one are about the name: what an Enter may complete. A match found only in
// the description is for reading, Enter then sends what was typed.
const NAME_TIER = 3
const SEPARATORS = /[:\-_.]/

function startsAWord(name: string, q: string) {
  for (let i = name.indexOf(q); i >= 0; i = name.indexOf(q, i + 1)) if (i === 0 || SEPARATORS.test(name[i - 1]!)) return true
  return false
}

// A single letter only counts at the start of the name or of a word of it: anywhere inside, or in
// a description, it would match nearly everything.
function tierOf(c: SlashCommand, q: string): number | null {
  let best: number | null = null
  for (const n of [c.name, ...(c.aliases || [])]) {
    const name = n.toLowerCase()
    const tier = name === q ? 0 : name.startsWith(q) ? 1 : startsAWord(name, q) ? 2 : q.length > 1 && name.includes(q) ? 3 : null
    if (tier !== null && (best === null || tier < best)) best = tier
  }
  if (best !== null) return best
  return q.length > 1 && c.desc?.toLowerCase().includes(q) ? 4 : null
}

// The commands that answer `token` (what follows the "/"), the closest first, alphabetical in a
// tier; all of them, alphabetical, for a bare "/".
export function matchSlash(commands: SlashCommand[], token: string): SlashMatch[] {
  const q = token.toLowerCase()
  const out: SlashMatch[] = []
  for (const cmd of commands) {
    const tier = q ? tierOf(cmd, q) : 1
    if (tier !== null) out.push({ cmd, tier, exact: token === cmd.name || Boolean(cmd.aliases?.includes(token)) })
  }
  return out.sort((a, b) => a.tier - b.tier || (a.cmd.name < b.cmd.name ? -1 : a.cmd.name > b.cmd.name ? 1 : 0))
}

// Where the highlight starts: on the first match when it is about the name, nowhere for a bare
// "/" (the whole list, to browse) or when only descriptions answered: Enter then sends the text as typed.
export const firstSlash = (matches: SlashMatch[], token: string) => (token && matches[0] && matches[0].tier <= NAME_TIER ? 0 : -1)

export type SlashKeyAction = { type: 'move', to: number } | { type: 'pick', index: number } | { type: 'close' }
export interface SlashKeyState {
  count: number
  // The highlighted row, -1 for none.
  active: number
  current: SlashMatch | undefined
  // The highlight was moved by hand (arrows, pointer).
  moved: boolean
}
interface KeyLike { key: string, shiftKey: boolean, ctrlKey: boolean, altKey: boolean, metaKey: boolean, isComposing?: boolean }

// What a key does while the list is open; null leaves the key to the field. Escape closes the
// list. With rows: arrows move the highlight (wrapping); Tab goes into the list, then completes
// the highlighted row; Enter completes it too, unless it is already what was typed (then it
// sends) or nothing is highlighted (then it sends what was typed).
export function slashKey(e: KeyLike, s: SlashKeyState): SlashKeyAction | null {
  if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null
  if (e.key === 'Escape') return { type: 'close' }
  if (s.count === 0) return null
  switch (e.key) {
    case 'ArrowDown':
      return { type: 'move', to: (s.active + 1) % s.count }
    case 'ArrowUp':
      return { type: 'move', to: s.active <= 0 ? s.count - 1 : s.active - 1 }
    case 'Tab':
      return s.active < 0 ? { type: 'move', to: 0 } : { type: 'pick', index: s.active }
    case 'Enter':
      if (s.active < 0 || (s.current?.exact && !s.moved)) return null
      return { type: 'pick', index: s.active }
    default:
      return null
  }
}
