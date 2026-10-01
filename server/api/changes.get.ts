import { readChanges } from '../utils/changes'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  if (!p.cwd) throw new HerdrError('bad_cwd', 'This agent’s folder is unknown')
  const m = machineFor(p.machine)
  return readChanges(m, p.cwd, q.commits === '1')
})
