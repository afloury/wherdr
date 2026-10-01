import { readChangeStatus } from '../../utils/changes'

export default defineApi(async (event) => {
  const p = findPane(String(getQuery(event).pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  if (!p.cwd) throw new HerdrError('bad_cwd', 'This pane’s folder is unknown')
  return readChangeStatus(machineFor(p.machine), p.cwd)
})
