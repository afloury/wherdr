import { readChanges } from '../utils/changes'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'pane introuvable')
  if (!p.cwd) throw new HerdrError('bad_cwd', 'dossier de cet agent inconnu')
  const m = machineFor(p.machine)
  return readChanges(m, p.cwd, q.commits === '1')
})
