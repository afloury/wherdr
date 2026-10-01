// Agent models: read from transcripts (Claude: `message.model`
// of replies and local "Set model to …" output of /model; Codex:
// `turn_context`), readable labels, and reading of the /model menu on screen.
//
// Menus captured (Claude Code v2.1.282, Codex v0.156.1):
//
//    Select model                                   Select Model and Effort
//    ❯ 1.  Default (recommended) ✔  Sonnet 5 · …     1. GPT-6-Astra (default)  Frontier…
//      2.  Opus 5.5                 Most capable…  › 2. GPT-6-Sol (current)    Workhorse…
//    ↓ 10. Opus 4.6                 Best for…        enter select · esc back
//       … +1 model
//    ◐ Medium effort (default) ←/→ to adjust        Select Reasoning Level for GPT-6-Luna
//    Enter to set as default · s to use this        › 2. Medium (default)  Balances…
//    session only · Esc to cancel                   enter default · s session · esc back
//
// ↑/↓ before a number: the list scrolls (Claude shows 10 at a time).
// Enter saves the choice as the global default (~/.claude/settings.json,
// ~/.codex/config.toml): we always confirm with `s` (this session only).
import type { ModelInfo, ModelOption } from '../../shared/types'
import { keysFor, parseChoices } from './choices'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

// claude-opus-5-5 → "Opus 5.5", claude-haiku-4-5-20251001 → "Haiku 4.5",
// claude-3-5-sonnet-20241022 → "Sonnet 3.5", claude-fable-5-1[1m] → "Fable 5.1 (1M)".
export function claudeModelLabel(id: string): string {
  const m = String(id || '').trim()
  const oneM = /\[1m\]$/i.test(m)
  const parts = m.replace(/\[[^\]]*\]$/, '').replace(/^claude-/i, '').split('-').filter(Boolean)
  const words = parts.filter(x => !/^\d+$/.test(x))
  const nums = parts.filter(x => /^\d{1,2}$/.test(x)) // dates (20251001) are ignored
  if (!words.length) return m
  const label = `${words.map(cap).join(' ')}${nums.length ? ' ' + nums.join('.') : ''}`
  return oneM ? `${label} (1M)` : label
}

// gpt-6-sol → "GPT-6-Sol", gpt-5.6-terra → "GPT-5.6-Terra", o3 → "o3".
export function codexModelLabel(id: string): string {
  const m = String(id || '').trim()
  if (!/^gpt-/i.test(m)) return m
  return m.split('-').map((x, i) => (i === 0 ? 'GPT' : cap(x))).join('-')
}

export const modelLabel = (kind: string | null, id: string) => (kind === 'codex' ? codexModelLabel(id) : claudeModelLabel(id))

// Label from a /model menu or output: "Opus 5 (1M context) (default)" → "Opus 5 (1M)".
export function cleanModelName(s: string): string {
  return String(s || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/✔/g, '')
    .replace(/\s*\((?:default|current)\)/gi, '')
    .replace(/\(1M context\)/i, '(1M)')
    .replace(/\s+/g, ' ')
    .trim()
}

// Same model? ("Opus 5.5" = "opus 5.5 (1M)"; parentheses are variants.)
export const sameModel = (a: string | null | undefined, b: string | null | undefined) => {
  const k = (s: string | null | undefined) => cleanModelName(s || '').replace(/\s*\(.*?\)/g, '').toLowerCase()
  return Boolean(a && b) && k(a) === k(b)
}

// Local /model output: "Set model to `Sonnet 5` for this session only",
// "Set model to `Opus 5 (1M context) (default)` and saved as…", "Kept model as `Opus 5.5`".
const SET_RE = /(?:Set model to|Kept model as)\s+`([^`]+)`/

// Model carried by a transcript line (null if it says nothing about it).
export function modelFromLine(line: string, kind: string | null): ModelInfo | null {
  if (!line) return null
  if (kind === 'codex') {
    if (!line.includes('"turn_context"')) return null
    let d: Json
    try { d = JSON.parse(line) }
    catch { return null }
    if (d.type !== 'turn_context' || !d.payload || !d.payload.model) return null
    const p = d.payload
    const effort = p.effort || (p.collaboration_mode && p.collaboration_mode.settings && p.collaboration_mode.settings.reasoning_effort) || null
    return { id: String(p.model), label: codexModelLabel(String(p.model)), effort, at: d.timestamp || null }
  }
  const setHit = line.includes('Set model to') || line.includes('Kept model as')
  if (!setHit && !line.includes('"model"')) return null
  let d: Json
  try { d = JSON.parse(line) }
  catch { return null }
  if (d.isSidechain) return null
  if (d.type === 'assistant' && d.message && typeof d.message.model === 'string') {
    const id = d.message.model
    if (!id || id.startsWith('<')) return null // "<synthetic>": error, interruption
    return { id, label: claudeModelLabel(id), effort: typeof d.effort === 'string' ? d.effort : null, at: d.timestamp || null }
  }
  if (setHit && (d.type === 'user' || d.type === 'system')) {
    const c = d.type === 'user' ? d.message && d.message.content : d.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: Json) => (x && x.text) || '').join('\n') : ''
    const m = text.match(SET_RE)
    if (!m || !text.includes('local-command-stdout')) return null
    const label = cleanModelName(m[1]!)
    return label ? { id: null, label, at: d.timestamp || null } : null
  }
  return null
}

// Last known model of a block of lines (the most recent wins).
export function lastModel(lines: string[], kind: string | null): ModelInfo | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const r = modelFromLine(lines[i]!, kind)
    if (r) return r
  }
  return null
}

// ---------------------------------------------------------------- menu /model
export interface ModelMenu {
  kind: 'model' | 'effort'
  options: (ModelOption & { n: number })[]
  cursor: number // number (1…) of the option under the cursor
  scrollDown: boolean // the list continues further down (↓ or "… +N")
  sessionKey: boolean // "s" = this session only
  enterSelects: boolean // Enter = move to the next step (Codex), not save
  effort: string | null // Claude: "◐ Medium effort"
}

const HEADER = /^\s*Select (?:model\b|Model and Effort|Reasoning Level)/i
const OPTION = /^\s*([❯›↑↓])?\s*(\d{1,2})\.\s+(\S.*?)\s*$/
const FOOTER = /Esc to cancel|esc back/i

export function parseModelMenu(text: string | null | undefined): ModelMenu | null {
  if (!text) return null
  const lines = String(text).replace(/\s+$/, '').split('\n').slice(-60)
  let h = -1
  for (let i = lines.length - 1; i >= 0; i--) if (HEADER.test(lines[i]!)) { h = i; break }
  if (h < 0) return null
  const rest = lines.slice(h + 1)
  const footer = rest.find(l => FOOTER.test(l))
  if (!footer) return null // menu closed: the header is just a leftover of history
  const options: ModelMenu['options'] = []
  let cursor = -1
  let scrollDown = false
  let effort: string | null = null
  for (const line of rest) {
    const m = line.match(OPTION)
    if (m) {
      const [labelPart, ...hint] = m[3]!.split(/\s{2,}/)
      const n = Number(m[2])
      if (m[1] === '❯' || m[1] === '›') cursor = n
      if (m[1] === '↓') scrollDown = true
      options.push({
        n,
        label: cleanModelName(labelPart!),
        hint: hint.join(' ').trim() || null,
        current: /✔|\(current\)/i.test(labelPart!),
        isDefault: /\(default\)/i.test(labelPart!),
      })
      continue
    }
    if (options.length && /^\s*…\s*\+\d+/.test(line)) scrollDown = true
    const e = line.match(/^\s*\S?\s*(\w[\w ]*?) effort\b/i)
    if (e && options.length) effort = e[1]!.toLowerCase()
  }
  if (!options.length || cursor < 0) return null
  // A real list: consecutive numbers.
  for (let i = 1; i < options.length; i++) if (options[i]!.n !== options[i - 1]!.n + 1) return null
  return {
    kind: /Reasoning Level/i.test(lines[h]!) ? 'effort' : 'model',
    options,
    cursor,
    scrollDown,
    sessionKey: /s to use this session only|\bs session\b/i.test(rest.join('\n')),
    enterSelects: /enter select/i.test(footer),
    effort,
  }
}

// Claude, in the middle of a conversation: after "s", it asks for confirmation
// ("Switch model? … ❯ 1. Yes, switch to Sonnet 4.6 / 2. No, go back") because the
// conversation cache will be re-read. Keys to answer "yes" to this
// specific question, for that model; null otherwise. (Enter here confirms the
// change for the session, without saving it as the default.)
export function switchConfirmKeys(text: string | null | undefined, label: string): string[] | null {
  if (!text || !/^\s*Switch model\?\s*$/m.test(text)) return null
  const c = parseChoices(text, { strict: true })
  if (!c) return null
  const i = c.options.findIndex((o) => {
    const m = o.label.match(/^Yes, switch to (.+)$/)
    return Boolean(m && sameModel(m[1], label))
  })
  return i < 0 ? null : keysFor(c, i)
}

// Codex: current effort ("medium", "xhigh") → menu option ("Medium (default)", "Extra high").
export function effortMatches(option: string, effort: string | null | undefined): boolean {
  if (!effort) return false
  const o = cleanModelName(option).toLowerCase().replace(/\s+/g, '')
  const e = String(effort).toLowerCase().replace(/[\s_-]+/g, '')
  return o === e || (e === 'xhigh' && o === 'extrahigh')
}

export function effortValue(label: string): string | null {
  const value = cleanModelName(label).toLowerCase().replace(/\s+/g, '')
  return value === 'extrahigh' ? 'xhigh' : /^(low|medium|high|xhigh|max|ultra|ultracode|minimal)$/.test(value) ? value : null
}

export function codexCachedEfforts(json: string, model: string): string[] {
  try {
    const data = JSON.parse(json)
    const entry = data.models?.find((m: { slug?: string, display_name?: string }) =>
      sameModel(m.slug, model) || sameModel(m.display_name, model))
    return Array.isArray(entry?.supported_reasoning_levels)
      ? entry.supported_reasoning_levels.map((x: { effort?: string }) => x.effort).filter((x: string) => Boolean(effortValue(x)))
      : []
  } catch { return [] }
}

// Claude exposes the extended levels on the most powerful reasoning models.
export function claudeEffortLevels(model: string | null | undefined): string[] {
  if (!model) return []
  const name = cleanModelName(model).replace(/\s*\([^)]*\)/g, '').toLowerCase()
  if (/^(?:opus|sonnet) 4\.6$/.test(name)) return ['low', 'medium', 'high', 'max']
  if (name === 'opus 5.5') return ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']
  if (/^(?:fable (?:5|5\.1)|opus (?:4\.7|4\.8|5|5\.5)|sonnet 5)$/.test(name)) return ['low', 'medium', 'high', 'xhigh', 'max']
  return []
}

export function claudeEffortCommand(level: string, model: string | null | undefined): string | null {
  // `/effort <level>` writes the user default; the slider without an argument
  // lets us choose the level then confirm with `s` for this session.
  // The real levels (including "ultracode") are checked on the displayed slider.
  const levels = claudeEffortLevels(model)
  if (!levels.length || effortValue(level) !== level) return null
  return levels.includes(level) || (level === 'ultracode' && levels.includes('xhigh')) ? '/effort' : null
}

export interface ClaudeEffortSlider {
  current: string
  levels: string[] // levels shown by Claude, in arrow order
}

// Slider legend: old ("s to use this session only") or 2.1.283
// ("←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel").
const SLIDER_SESSION = /s (?:to use|for) this session only/i

// Claude Code's /effort slider, read at the bottom of the screen; null if it is not open.
// 2.1.283: "───▲───┊───" ruler above the "low  medium … max  ultracode" labels;
// the current level is the label closest to the ▲ column.
export function parseClaudeEffortScreen(text: string | null | undefined): ClaudeEffortSlider | null {
  const lines = String(text || '').replace(/\s+$/, '').split('\n').slice(-30)
  let legend = -1
  for (let i = lines.length - 1; i >= 0; i--) if (SLIDER_SESSION.test(lines[i]!)) { legend = i; break }
  if (legend < 0) return null
  const body = lines.slice(0, legend)
  for (let r = body.length - 1; r >= 0; r--) {
    const ruler = Array.from(body[r]!)
    const mark = ruler.indexOf('▲')
    if (mark < 0 || !ruler.some(c => c === '─')) continue
    // Label line: the first one below the ruler that contains any.
    for (let k = r + 1; k < body.length; k++) {
      const chars = Array.from(body[k]!)
      const words: { value: string, from: number, to: number }[] = []
      const re = /\S+/g
      const str = chars.join('')
      let m: RegExpExecArray | null
      while ((m = re.exec(str))) {
        const value = effortValue(m[0])
        const from = Array.from(str.slice(0, m.index)).length
        if (value) words.push({ value, from, to: from + Array.from(m[0]).length - 1 })
      }
      if (words.length < 2) continue
      const dist = (w: typeof words[number]) => mark < w.from ? w.from - mark : mark > w.to ? mark - w.to : 0
      const best = words.reduce((a, b) => (dist(b) < dist(a) ? b : a))
      return { current: best.value, levels: words.map(w => w.value) }
    }
    return null
  }
  // Old screen: "◐ Medium effort (default) ←/→ to adjust".
  const m = body.join('\n').match(/[●◐○◑◒◓]\s*(Low|Medium|High|Extra high|xhigh|Max) effort/i)
  const current = m ? effortValue(m[1]!) : null
  return current ? { current, levels: [] } : null
}

export function parseClaudeEffortSlider(text: string | null | undefined): string | null {
  return parseClaudeEffortScreen(text)?.current || null
}

// Claude's current effort announced on screen: banner ("Opus 5.5 with low effort")
// or /effort output ("Set effort level to low (for this session only)"); the lowest wins.
export function claudeScreenEffort(text: string | null | undefined): string | null {
  const lines = String(text || '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i]!.match(/\bwith (low|medium|high|xhigh|max|ultracode) effort\b|Set effort level to (low|medium|high|xhigh|max|ultracode)\b/i)
    if (m) return (m[1] || m[2])!.toLowerCase()
  }
  return null
}

// Claude: model announced on screen, for an agent that has no
// transcript yet. Claude Code header ("Opus 5.5 with low effort · Claude
// Pro", "Sonnet 5 (1M context) · Claude Max") or output of a typed /model
// ("Set model to Sonnet 5"). The lowest wins.
const HEADER_RE = /([A-Z][A-Za-z]+ \d+(?:\.\d+)*(?: \([^)]*\))?)(?: with (low|medium|high|xhigh|max|ultracode) effort)? · (?:Claude\b|API\b)/
const SET_SCREEN_RE = /(?:Set model to|Kept model as) `?([^`\n]+?)`?(?= for this session| and saved|\s*$)/
export function claudeScreenModel(text: string | null | undefined): ModelInfo | null {
  const lines = String(text || '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.replace(/\s+$/, '')
    const s = SET_SCREEN_RE.exec(l)
    if (s) {
      const label = cleanModelName(s[1]!)
      if (label) return { id: null, label, effort: null, at: null }
    }
    const h = HEADER_RE.exec(l)
    if (h) return { id: null, label: cleanModelName(h[1]!), effort: h[2] ? h[2].toLowerCase() : null, at: null }
  }
  return null
}

// Idle Codex: its status line below the input field gives the model and
// effort actually in effect ("GPT-5.6-Terra medium · ~ · …"), including
// after a /model typed elsewhere, which the rollout only records on the next turn.
export function codexFooterModel(text: string | null | undefined): ModelInfo | null {
  const lines = String(text || '').replace(/\s+$/, '').split('\n').slice(-6)
  const input = lines.findIndex(l => /^\s*›\s/.test(l))
  if (input < 0) return null
  for (const l of lines.slice(input + 1)) {
    const m = l.match(/^\s*((?:GPT|gpt)-[\w.-]+|o\d[\w.-]*)(?:\s+(minimal|low|medium|high|xhigh|max|ultra))?\s+·/)
    if (m) return { id: null, label: m[1]!.startsWith('gpt') ? codexModelLabel(m[1]!) : m[1]!, effort: m[2] || null, at: null }
  }
  return null
}

// Codex: default model and effort (~/.codex/config.toml, top-level keys).
export function codexConfigModel(toml: string): ModelInfo | null {
  const top = String(toml || '').split(/^\s*\[/m)[0]!
  const m = top.match(/^\s*model\s*=\s*"([^"]+)"/m)
  if (!m) return null
  const e = top.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)
  return { id: m[1]!, label: codexModelLabel(m[1]!), effort: e ? e[1]! : null, at: null }
}
