// Card subtitle of a terminal on herdr-core: the agent's last reply (its conversation, when
// it can be found) else the last meaningful line of the terminal. Read in the background and
// only when the terminal's state changed, so the one-second inventory poll stays cheap.
import type { Pane } from '../../shared/types'

const MAX = 200
const MAX_BUSY = 4
const WORKING_MS = 10_000

// A prompt alone ("user@host:~/dir$", "❯"), or a rule made of box-drawing characters.
const PROMPT = /(?:^|\s)[\w.-]+@[\w.-]+:[^\s]*\s*[$#%]\s*$|^[$#%>❯»]\s*$/u
const RULE = /^[\s─━│┃┌┐└┘├┤┬┴┼╭╮╰╯═║\-_=*·.]*$/u

// TUI footers (Claude, Codex): key hints and mode lines, never content.
const FOOTER = /^(?:[⏵▶►]{1,2}\s|←\s+for agents|\?\s+for shortcuts|auto mode (?:on|off)\b|accept edits on\b|plan mode on\b|bypass permissions on\b|esc to interrupt|enter to (?:confirm|select)\b|esc to cancel|ctrl\+[a-z] to |shift\+tab to |tab to (?:queue|cycle)|\d+% context left|gpt-[\w.-]+ .*·|\S+ · \d+% left)/iu

// Empty-input placeholders ("› Ask Codex to do anything", '❯ Try "fix lint errors"') and the
// status lines under them ("◐ medium · /effort", "GPT-6 medium · ~/dir · title").
const PLACEHOLDER = /^[›❯]\s+(?:Ask \S+ to do anything|Try "[^"]*"|Type a message)\s*$/iu
const MODEL_LINE = /^(?:[◐◑◒◓○●◔◕]\s+)?(?:\S+\s+)?(?:minimal|low|medium|high|xhigh|max)\s+·\s/iu

// Claude's turn summary under a finished answer: '✻ Worked for 2s · done 5:11 PM', '✻ Churned for 1m 3s'.
const DURATION = /^[✻✶✳✢·*]\s+\S+(?:\s+\S+)?\s+for\s+\d+\s*(?:ms|[smh])\b.*$/u

export function lastLine(text: string): string | null {
  const lines = text.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim() && !RULE.test(l) && !PROMPT.test(l.trim()) && !FOOTER.test(l.trim()) && !PLACEHOLDER.test(l.trim()) && !MODEL_LINE.test(l.trim()) && !DURATION.test(l.trim()))
  const line = lines.at(-1)?.trim().replace(/^⏺\s+/u, '')
  if (!line) return null
  return line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line
}

export interface CorePreviewDeps {
  reply: (pane: Pane) => Promise<{ text: string } | null>
  read: (address: string) => Promise<string>
  now?: () => number
}

export function createCorePreviews(deps: CorePreviewDeps) {
  const now = deps.now ?? Date.now
  const cache = new Map<string, { key: string, text: string | null, at: number }>()
  const busy = new Set<string>()
  async function load(p: Pane): Promise<string | null> {
    if (p.error) return p.error.length > MAX ? `${p.error.slice(0, MAX - 1)}…` : p.error
    if (p.agent) {
      const reply = await deps.reply(p).catch(() => null)
      if (reply?.text) return reply.text.length > MAX ? `${reply.text.slice(0, MAX - 1)}…` : reply.text
    }
    return lastLine(await deps.read(p.coreAddress!))
  }
  return {
    /** Sets `preview` on the panes from what is known; starts the readings that are due. */
    apply(panes: Pane[]) {
      const live = new Set(panes.map(p => p.id))
      for (const id of cache.keys()) if (!live.has(id)) cache.delete(id)
      for (const p of panes) {
        if (!p.coreAddress) continue
        const hit = cache.get(p.id)
        const key = `${p.status}:${p.stateSeq ?? ''}:${p.error ? 'e' : ''}`
        const due = !hit || hit.key !== key || (p.status === 'working' && now() - hit.at > WORKING_MS)
        if (due && !busy.has(p.id) && busy.size < MAX_BUSY) {
          busy.add(p.id)
          load(p)
            .then(text => { cache.set(p.id, { key, text, at: now() }) })
            .catch(() => { cache.set(p.id, { key, text: hit?.text ?? null, at: now() }) })
            .finally(() => busy.delete(p.id))
        }
        if (hit?.text) p.preview = hit.text
      }
    },
  }
}
