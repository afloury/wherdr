import { readChangeStatus } from '../../utils/changes'

export default defineApi(async (event) => {
  const p = findPane(String(getQuery(event).pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'pane introuvable')
  if (!p.cwd) throw new HerdrError('bad_cwd', 'dossier de ce pane inconnu')
  return readChangeStatus(machineFor(p.machine), p.cwd)
})
