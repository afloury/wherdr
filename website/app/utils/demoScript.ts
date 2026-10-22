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
  /** Last line of its conversation: the question its line opens on when it waits for you. */
  line: string
  /** A project task's key (SHOP-15), before its title. */
  tag?: string
  /** A project task's progress and time ("40% 24m"). */
  stats?: string
}
/** A herdr-projects repo in the list (app/components/ProjectGroup.vue): its coordinator's row, then its tasks. */
export type DemoProject = {
  repo: string
  /** Its coordinator's state. */
  coordinator: AgentState
  branch?: string
  tasks: readonly DemoAgent[]
}

/** The other agents of the list by state, as HomeView.vue groups them: your turn, working, ready (done or idle); empty groups left out. */
export function listGroups(agents: readonly DemoAgent[]) {
  return [
    { key: 'blocked', title: 'Your turn', list: agents.filter(a => a.state === 'blocked') },
    { key: 'working', title: 'Working', list: agents.filter(a => a.state === 'working') },
    { key: 'ready', title: 'Ready', list: agents.filter(a => a.state === 'done' || a.state === 'idle') },
  ].filter(g => g.list.length)
}

/** A project's bar (ProjectGroup.vue): "2 tasks · 1 your turn · 1 working", counts of zero left out. */
export function projectSummary(tasks: readonly DemoAgent[]) {
  const n = (s: AgentState) => tasks.filter(t => t.state === s).length
  return [
    { key: 'all', text: `${tasks.length} tasks` },
    { key: 'blocked', text: `${n('blocked')} your turn`, n: n('blocked') },
    { key: 'working', text: `${n('working')} working`, n: n('working') },
  ].filter(p => p.n !== 0)
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
