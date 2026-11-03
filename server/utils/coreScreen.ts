// herdr-core agents: what the screen says (WHR-260). hc often reports no status
// for Claude Code (no OSC 7501) and never describes a question, so the visible
// screen (terminal.read) fills in `prompt`, `interaction` and, when core
// reports nothing, the status. Reads are cached, bounded and never fatal.
import type { Choices, Pane } from '../../shared/types'
import { classifyScreen, confirmedInput } from '../../shared/interactiveScreen'
import { codexError } from '../../shared/codexError'
import { hasTranscript } from '../../shared/agentKind'
import { parseChoices, parseOmpPrompt, promptIdentity, completeClaudeAsk, type ClaudeAsked } from './choices'
import { queueSendNow, readDraft, sameText } from './coreDraft'

const WORKING = /\besc(?:ape)? to interrupt\b/i
// Claude's folder-trust box: unnumbered options, so it needs the non-strict reading
// even while core reports no status.
const TRUST_FOLDER = /Is this a project you created or one you trust\?[\s\S]*Yes, I trust this folder/
// Claude's spinner line: "✻ Pondering… (12s · ↑ 1.2k tokens)".
const SPINNER = /^\s*[*✢✳✶✻✽·]\s+\S.*…\s*\(\d+[smh]/

export interface CoreReading {
  status: 'working' | 'blocked' | 'idle' | null
  choices: Choices | null
  interaction: NonNullable<Pane['interaction']>
}

// Pure: screen text of an agent -> what to show. `status`: core's own, if any.
export function readCoreScreen(text: string, agent: string | null | undefined, status: string | null | undefined): CoreReading {
  const tail = text.trimEnd().split('\n').slice(-14).join('\n')
  const working = WORKING.test(tail) || tail.split('\n').some(l => SPINNER.test(l))
  let choices: Choices | null = null
  if (!working) {
    choices = agent === 'omp' ? parseOmpPrompt(text) : parseChoices(text, { strict: status !== 'blocked' && !(agent === 'claude' && TRUST_FOLDER.test(tail)) })
    if (choices) choices.identity = promptIdentity(text, agent)
  }
  const known = status && status !== 'unknown' ? status : null
  const derived = known ? null : working ? 'working' : choices ? 'blocked' : confirmedInput(text) ? 'idle' : null
  // `screen`/`menu` cards have no core route yet: such screens stay terminals.
  const interaction = (derived || known) === 'working' ? 'working'
    : classifyScreen({ text, agent, choices, status: known || derived || 'unknown' })
  return { status: derived, choices, interaction }
}

export interface CoreScreenDeps {
  call: (method: string, params: object, timeout: number) => Promise<{ text?: string }>
  viewed: (id: string) => boolean
  asked?: (p: Pane) => Promise<ClaudeAsked[]>
  /** Colored screen (see corePaint): without it, no draft is shown. */
  colors?: (p: Pane) => Promise<string>
  now?: () => number
}

const VIEWED_MS = 1000
const IDLE_MS = 5000
const MAX_READS = 6
// A draft is shown once it stayed the same this long (not while someone types it)
// and the colored screen confirms it.
const DRAFT_MS = 2000
// A new agent whose screen says nothing yet (Claude starting, before its trust box) is read
// at every poll during its first STARTUP_MS, not at the background pace: the poll its
// drawing triggers then shows the question at once, in step with the card's preview.
const STARTUP_MS = 30_000

export function createCoreScreens(deps: CoreScreenDeps) {
  const now = deps.now ?? Date.now
  const cache = new Map<string, { at: number, text: string, open?: boolean }>()
  const born = new Map<string, number>()
  const failed = new Set<string>()
  const drafts = new Map<string, { text: string, since: number, real?: boolean }>()
  const read = async (p: Pane) => {
    try {
      const r = await deps.call('terminal.read', { terminal: p.coreAddress, lines: 0 }, 3000)
      cache.set(p.id, { at: now(), text: String(r?.text ?? '') })
      failed.delete(p.id)
    } catch { failed.add(p.id) }
  }
  return {
    forget: (id: string) => { cache.delete(id) },
    /** Fresh screen of one agent (before validating an answer). */
    async fresh(p: Pane): Promise<string> {
      const r = await deps.call('terminal.read', { terminal: p.coreAddress, lines: 0 }, 3000)
      return String(r?.text ?? '')
    },
    // Fills the agents of one state (in place). Working agents whose status core
    // reports are not read: normal activity is not a question. An open Claude
    // conversation still is, for its queue's "send now".
    async enrich(panes: Pane[]): Promise<void> {
      const agents = panes.filter(p => p.coreAddress && p.agent && hasTranscript(p.agent)
        && (p.status !== 'working' || (p.agent === 'claude' && deps.viewed(p.id))))
      const due = agents.filter(p => {
        const c = cache.get(p.id)
        if (!c || (c.open && now() - (born.get(p.id) ?? 0) < STARTUP_MS)) return true
        return now() - c.at >= (deps.viewed(p.id) ? VIEWED_MS : IDLE_MS)
      }).sort((a, b) => Number(deps.viewed(b.id)) - Number(deps.viewed(a.id))).slice(0, MAX_READS)
      await Promise.all(due.map(read))
      const alive = new Set(panes.map(p => p.id))
      for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id)
      for (const id of born.keys()) if (!alive.has(id)) born.delete(id)
      for (const id of drafts.keys()) if (!alive.has(id)) drafts.delete(id)
      for (const p of agents) {
        const c = cache.get(p.id)
        if (!c) continue
        const r = readCoreScreen(c.text, p.agent, p.status)
        if (!born.has(p.id)) born.set(p.id, c.at)
        c.open = !r.status && !(p.status && p.status !== 'unknown')
        let choices = r.choices
        if (choices && p.agent === 'claude' && deps.asked) choices = completeClaudeAsk(choices, await deps.asked(p).catch(() => []))
        if (r.status) p.status = r.status
        const error = p.agent === 'codex' ? codexError(c.text) : null
        if (error) p.error = error
        else delete p.error
        p.interaction = failed.has(p.id) ? 'unknown' : r.interaction
        if (choices && r.interaction === 'native') p.prompt = choices
        if (queueSendNow(c.text, p.agent)) p.queueSendNow = true
        const draft = !failed.has(p.id) && r.interaction === 'input' && p.status !== 'working' ? readDraft(c.text, p.agent) : null
        const seen = drafts.get(p.id)
        if (!draft) drafts.delete(p.id)
        else if (seen?.text !== draft.text) drafts.set(p.id, { text: draft.text, since: c.at })
        else if (c.at - seen.since >= DRAFT_MS && deps.colors) {
          // Once per text: is it typed, or Claude's gray suggestion (same bytes on the plain screen)?
          seen.real ??= await deps.colors(p).then(ansi => sameText(readDraft(ansi, p.agent)?.text ?? '', draft.text), () => false)
          if (seen.real) p.draft = draft
        }
      }
    },
  }
}
