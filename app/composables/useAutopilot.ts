import type { AutopilotStatus } from '#shared/autopilot'
import { ApiError, api } from '~/composables/useHerdr'

// Every coordinator's Autopilot on each machine, from one `autopilot --json` per
// machine shared by all switches. What is shown is what herdr-projects said last.
interface MachineAutopilot { statuses?: Record<string, AutopilotStatus>, error?: string, code?: string, at: number }

const FRESH_MS = 20_000
const loading = new Map<string, Promise<void>>()

export function useAutopilot() {
  const machines = useState<Record<string, MachineAutopilot>>('autopilot', () => ({}))
  function load(machine: string, force = false): Promise<void> {
    const had = machines.value[machine]
    if (!force && had && Date.now() - had.at < FRESH_MS) return Promise.resolve()
    const running = loading.get(machine)
    if (running && !force) return running
    const next = api<Record<string, AutopilotStatus>>(`/api/tasks/autopilot?${new URLSearchParams({ machine })}`)
      .then((statuses) => { machines.value[machine] = { statuses, at: Date.now() } })
      .catch((e) => { machines.value[machine] = { error: (e as Error).message, code: e instanceof ApiError ? e.code : undefined, at: Date.now() } })
      .finally(() => { if (loading.get(machine) === next) loading.delete(machine) })
    loading.set(machine, next)
    return next
  }
  // A coordinator's state as one action read it back.
  function put(machine: string, id: string, status: AutopilotStatus) {
    const had = machines.value[machine]
    machines.value[machine] = { statuses: { ...had?.statuses, [id]: status }, at: had?.statuses ? had.at : 0 }
  }
  return { machines, load, put }
}
