import { splitId } from '../../shared/ids'

// ID d'un pane tel que Herdr le connaît sur sa machine (w1:p2) : sans le
// préfixe « <machine>~ » que wherdr ajoute aux panes des machines distantes.
export const herdrPaneId = (id: string) => splitId(id).local

// Ligne affichée sous « Copier l'ID du pane » : l'ID, et la machine si distante.
export function paneIdLine(id: string, machineLabel?: string | null): string {
  const { machine, local } = splitId(id)
  return machine && machineLabel ? `${local} · ${machineLabel}` : local
}
