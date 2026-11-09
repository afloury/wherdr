// The project sheet's tabs (shared/pm/places.ts), and the one a URL asks for (`?tab=`): General by default.
import { PROJECT_TABS, type ProjectTab } from '../../shared/pm/places'
import { BAR_ALL, type MachineGroup } from './machineBar'

export { PROJECT_TABS, PROJECT_TAB_LABEL, type ProjectTab } from '../../shared/pm/places'
export const projectTab = (q: unknown): ProjectTab => (PROJECT_TABS as readonly unknown[]).includes(q) ? q as ProjectTab : 'general'

// Which home tab (machine bar) shows a project: its coordinator and its tasks
// to handle. A project has tab machines: those of the group it is pinned to,
// every machine (null) when pinned to all tabs, or by default (no pin, or the
// group was deleted) its allowed machines. A tab shows it when they meet.
// project.machines: its allowed machines (CoordinatorView.machines); override:
// its entry in the projectTabs setting (readProjectTabs), undefined = automatic.
export function projectTabMachines(project: { machines: readonly string[] }, override: string | undefined, groups: readonly MachineGroup[]): string[] | null {
  if (override === BAR_ALL) return null
  const group = override ? groups.find(g => g.id === override) : undefined
  return [...(group?.machines ?? project.machines)]
}

// selection: the tab's machines (barMachineSelection), null = the All tab.
export const projectOnTab = (tabMachines: readonly string[] | null, selection: readonly string[] | null) =>
  !selection || !tabMachines || tabMachines.some(m => selection.includes(m))
