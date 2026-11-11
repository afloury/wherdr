// The setup wizard of project management: six steps for one project, each done
// or not from what the server reports. Pure, so the board, the settings and the
// tests read the same answer.
import type { Pane } from '../types'
import type { PmOverview } from './project'
import type { Template } from './workflow'

export const SETUP_STEPS = ['enable', 'project', 'workflow', 'guards', 'coordinator', 'task'] as const
export type SetupStepId = (typeof SETUP_STEPS)[number]
export type SetupDone = Record<SetupStepId, boolean>

// Only what the wizard needs from a coordinator: its project and whether a
// conversation was started (it then has a terminal).
type Coord = { project: string, terminal?: string }
type Overview = Pick<PmOverview, 'enabled' | 'projects' | 'tasks'>

// The guards come with the workflow (its defaults): done once it is copied.
// start: its coordinator's state from its live pane (the wizard): step 5 is
// done only once it runs, not while its pane has not arrived, starts or asks something.
export function setupDone(o: Overview | null, key: string | undefined, coords: Coord[] = [], start?: CoordinatorStart): SetupDone {
  const p = o?.enabled ? o.projects.find(x => x.key === key && x.git !== false) : undefined
  const flow = !!p?.from
  return {
    enable: !!o?.enabled,
    project: !!p,
    workflow: flow,
    guards: flow,
    coordinator: flow && coords.some(c => c.project === p!.key && !!c.terminal) && (start === undefined || start === 'runs'),
    task: flow && !!o?.tasks?.some(t => t.project === p!.key),
  }
}

// Step 5 from its coordinator's pane: not started, starting (no state yet, or
// one core cannot tell), asking something before it can work (a dialog, a
// login), or running (idle, working, done).
export type CoordinatorStart = 'none' | 'starting' | 'asks' | 'runs'
export function coordinatorStart(pane?: Pick<Pane, 'status' | 'prompt' | 'screen'>): CoordinatorStart {
  if (!pane) return 'none'
  if (pane.status === 'blocked' || pane.prompt || pane.screen) return 'asks'
  return pane.status && pane.status !== 'unknown' ? 'runs' : 'starting'
}

export const setupCount = (d: SetupDone) => SETUP_STEPS.filter(s => d[s]).length
// Where the wizard opens: the first step left, or past the last when all are done.
export const setupResume = (d: SetupDone) => {
  const i = SETUP_STEPS.findIndex(s => !d[s])
  return i < 0 ? SETUP_STEPS.length : i
}

// The project the wizard finishes: the first git project with a step left, else the first one.
export function setupProject(o: Overview | null, coords: Coord[] = []): string | undefined {
  const git = o?.projects.filter(p => p.git !== false) ?? []
  return (git.find(p => setupCount(setupDone(o, p.key, coords)) < SETUP_STEPS.length) ?? git[0])?.key
}

// Set up: one project went through every step. The board then shows nothing.
export const setupComplete = (o: Overview | null, coords: Coord[] = []) =>
  !!o?.projects.some(p => setupCount(setupDone(o, p.key, coords)) === SETUP_STEPS.length)

// A workflow in one line: each task type's steps ("simple: todo → work → done").
export const workflowLine = (t: Pick<Template, 'taskTypes'>) => Object.entries(t.taskTypes)
  .map(([type, tt]) => `${type}: ${tt.steps.map(s => (typeof s === 'string' ? s : s.id)).join(' → ')}`).join(' · ')
