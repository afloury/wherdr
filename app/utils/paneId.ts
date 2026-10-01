import { splitId } from '../../shared/ids'

// ID of a pane as Herdr knows it on its machine (w1:p2): without the
// "<machine>~" prefix that wherdr adds to the panes of remote machines.
export const herdrPaneId = (id: string) => splitId(id).local

// Line shown under "Copy pane ID": the ID, and the machine if remote.
export function paneIdLine(id: string, machineLabel?: string | null): string {
  const { machine, local } = splitId(id)
  return machine && machineLabel ? `${local} · ${machineLabel}` : local
}
