// A looping demo on the site: numbered steps reached at given times. Played by
// useDemoClock; the views derive everything they show from the current step.
export type DemoScript = {
  /** Views of the same id share one clock. */
  id: string
  /** [ms after the loop starts, step reached], in time order. */
  timeline: readonly (readonly [at: number, step: number])[]
  /** Loop length in ms; the loop restarts at step 0. */
  loop: number
  /** Step shown still under prefers-reduced-motion. */
  final: number
  /** Text typed two characters at a time over `ms`, starting at `step`. */
  typing?: { step: number, text: string, ms: number }
}

/** An agent's state, with the app's keys (app/composables/useActions.ts STATUS). */
export type AgentState = 'blocked' | 'working' | 'done' | 'idle'
/** The app's state labels, lowercase as its state pill writes them. */
export const STATE_LABEL: Record<AgentState, string> = { blocked: 'your turn', working: 'working', done: 'done', idle: 'ready' }
export type AgentKind = 'claude' | 'codex' | 'omp'
/** Agent logos (app/utils/agentIcons.ts) and names (app/utils/format.ts KIND_LABEL). */
export const AGENT_ICON: Record<AgentKind, string> = { claude: 'i-herdr-claude-code', codex: 'i-herdr-codex', omp: 'i-herdr-omp' }
export const KIND_LABEL: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex', omp: 'omp' }
/** An agent in wherdr's list (sidebar, phone home): the app's card fields. */
export type DemoAgent = {
  name: string
  agent: AgentKind
  state: AgentState
  model: string
  effort?: string
  /** Last line of its conversation (card preview). */
  line: string
  /** Role in a project: COORDINATOR, T-0001. */
  tag?: string
  /** Folder, under the state. */
  where?: string
}

/** Problems that would make a script play wrong (empty when it is sound). */
export function scriptProblems(s: DemoScript): string[] {
  const out: string[] = []
  let prevAt = 0
  let prevStep = 0
  for (const [at, step] of s.timeline) {
    if (at <= prevAt) out.push(`${s.id}: ${at} ms is not after ${prevAt} ms`)
    if (step !== prevStep + 1) out.push(`${s.id}: step ${step} follows step ${prevStep}`)
    prevAt = at
    prevStep = step
  }
  if (prevAt >= s.loop) out.push(`${s.id}: the last step is not before the loop end`)
  if (s.final < 1 || s.final > prevStep) out.push(`${s.id}: final step ${s.final} is never reached`)
  const t = s.typing
  if (t) {
    const start = s.timeline.find(([, step]) => step === t.step)
    const next = s.timeline.find(([, step]) => step === t.step + 1)
    if (!start) out.push(`${s.id}: typing step ${t.step} is never reached`)
    else if (next && start[0] + t.ms > next[0]) out.push(`${s.id}: typing runs past step ${t.step + 1}`)
  }
  return out
}
