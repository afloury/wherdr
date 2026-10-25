// A machine's board settings: `?machine=<key>[&repo=<name>]` (`show --json [--repo]`).
import { boardSettings } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const q = getQuery(event)
  return boardSettings(q.machine ?? '', q.repo)
})
