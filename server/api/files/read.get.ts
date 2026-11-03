import { readFilePreview, readWrittenPreview } from '../../utils/files'

// `from=chat`: a path as written in a conversation (under the home folder),
// otherwise a path relative to the browsed project.
export default defineApi(async (event) => {
  const q = getQuery(event)
  const p = findPane(String(q.pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  if (q.from === 'chat') return readWrittenPreview(await filesMachine(p.machine, machineFor), p.cwd, q.path)
  if (!p.cwd) throw new HerdrError('bad_cwd', 'This agent’s folder is unknown')
  return readFilePreview(await filesMachine(p.machine, machineFor), p.cwd, q.path)
})
