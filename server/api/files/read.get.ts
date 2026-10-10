import { readFilePreview } from '../../utils/files'

export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  if (!p.cwd) throw new HerdrError('bad_cwd', 'This agent’s folder is unknown')
  return readFilePreview(machineFor(p.machine), p.cwd, q.path)
})
