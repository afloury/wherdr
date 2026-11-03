// The coordinator's first message: coordinator.md with the project's values filled in.
export interface CoordinatorVars { project: string, tasksFile: string, maxWorkers: number }

export function renderCoordinator(template: string, v: CoordinatorVars): string {
  return template.replace(/\{\{(project|tasksFile|maxWorkers)\}\}/g, (_, k: keyof CoordinatorVars) => String(v[k])).trim()
}
