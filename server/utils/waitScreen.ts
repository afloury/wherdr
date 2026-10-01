// Agents' waiting screens (mostly Codex at startup): "Hooks" box,
// folder trust, login, update… Herdr sees the agent as "idle" and
// there is no conversation yet: without this, wherdr only showed
// "No conversation yet". These screens all end with a key
// legend, the last line of the screen:
//
//   Hooks
//   Lifecycle hooks from config and enabled plugins.
//   ⚠ 4 hooks need review before they can run.
//   …
//   t trust all · enter review · esc close
//
// When idle, the last line is the agent's status bar ("? for
// shortcuts", model · folder): never a legend.
import type { WaitAction, WaitKind, WaitScreen } from '../../shared/types'

// Keys accepted in a legend; single letters only in a
// legend with several entries ("t trust all · …"), otherwise "a new version…"
// would pass for the "a" key.
const KEY_NAMES: Record<string, string> = { enter: 'enter', return: 'enter', esc: 'esc', escape: 'esc', tab: 'tab' }
const NAV = /^(?:[↑↓←→](?:\s*\/\s*[↑↓←→])*|tab|shift\+tab|ctrl\+\w|space)(?=\s|$)/i

function action(seg: string, letters: boolean): WaitAction | null | 'nav' {
  const s = seg.trim().replace(/[.;,]$/, '')
  const m = s.match(/^(?:press\s+)?(\S+)\s+(?:to\s+)?(.+)$/i)
  if (m) {
    const k = m[1]!.toLowerCase()
    const label = m[2]!.trim()
    const key = KEY_NAMES[k] || (letters && /^[a-z0-9]$/.test(k) ? k : null)
    if (key && label.length <= 32 && label.split(/\s+/).length <= 5) return { key, label }
  }
  return NAV.test(s) ? 'nav' : null
}

// Legend line → its actions (null if it is not one).
export function parseLegend(line: string): WaitAction[] | null {
  const segs = line.trim().split(/\s+·\s+|\s{3,}/).filter(Boolean)
  if (!segs.length) return null
  const out: WaitAction[] = []
  for (const seg of segs) {
    const a = action(seg, segs.length > 1)
    if (!a) return null
    if (a !== 'nav') out.push(a)
  }
  return out.length ? out : null
}

const ART = /[⠀-⣿]/ // logo de Codex en braille
const HEADER = /^>_ OpenAI Codex\b/
const SCROLL = /^[↑↓]$/
const OPTION = /^\s*(?:(?:[❯›>]\s+)?\d{1,2}\.\s|[❯›]\s)/

// Title and nature of the known screens.
const KNOWN: { kind: WaitKind, title: RegExp, confirm?: RegExp }[] = [
  { kind: 'hooks', title: /^Hooks(?: need review)?$/, confirm: /hooks? (?:need|needs) review|hooks are new or changed/i },
  { kind: 'trust', title: /^(?:Folder access|Do you trust\b.*|Trust this folder\b.*)$/i },
  { kind: 'login', title: /^(?:Welcome to Codex\b.*|Sign in with ChatGPT\b.*)$/ },
  { kind: 'update', title: /^(?:✨\s*)?(?:Update available\b.*|A new version of Codex\b.*)$/i },
]

// `choices`: the screen also contains a list of options (read by parseChoices),
// shown as separate buttons: the text then stops before it.
export function parseWaitScreen(text: string | null | undefined, { choices = false }: { choices?: boolean } = {}): WaitScreen | null {
  if (!text) return null
  const lines = text.replace(/\s+$/, '').split('\n').slice(-60).map(l => l.replace(/\s+$/, ''))

  // Legend: 1 to 3 last non-empty lines.
  let end = lines.length
  const actions: WaitAction[] = []
  for (let i = lines.length - 1, n = 0; i >= 0 && n < 3; i--) {
    if (!lines[i]!.trim()) continue
    const a = parseLegend(lines[i]!)
    if (!a) break
    actions.unshift(...a)
    end = i
    n++
  }
  if (!actions.length) return null

  // Block above the legend: up to 3 consecutive empty lines, the logo or
  // Codex's header.
  let start = end
  for (let i = end - 1, blank = 0; i >= 0 && end - i <= 40; i--) {
    const t = lines[i]!.trim()
    if (!t) { if (++blank >= 3) break; continue }
    blank = 0
    if (ART.test(t) || HEADER.test(t)) break
    start = i
  }
  let block = lines.slice(start, end)

  let kind: WaitKind = 'other'
  let title: string | null = null
  const all = block.join('\n')
  for (const k of KNOWN) {
    const at = block.findIndex(l => k.title.test(l.trim()))
    if (at < 0 || (k.confirm && !k.confirm.test(all))) continue
    kind = k.kind
    title = block[at]!.trim()
    block = block.slice(at + 1)
    break
  }

  if (choices) {
    const o = block.findIndex(l => OPTION.test(l))
    if (o >= 0) block = block.slice(0, o)
  }
  block = block.filter(l => !SCROLL.test(l.trim()))
  while (block.length && !block[0]!.trim()) block.shift()
  while (block.length && !block[block.length - 1]!.trim()) block.pop()
  // Doubled empty lines → a single one; common indentation removed (aligned tables).
  block = block.filter((l, i) => l.trim() || (i > 0 && block[i - 1]!.trim()))
  const indent = Math.min(...block.filter(l => l.trim()).map(l => l.match(/^\s*/)![0].length))
  const body = block.slice(-16).map(l => (Number.isFinite(indent) ? l.slice(indent) : l).slice(0, 160))

  return { kind, title: title ? title.slice(0, 200) : null, lines: body, actions }
}
