// Which panes and spaces belong to each machine's herdr-projects board (the
// home list's project groups). `since=<version>`: `{ same: true }` when nothing
// changed. See server/utils/boardLinks.ts.
import { readBoardLinks } from '../../utils/boardLinks'

export default defineApi(async (event) => {
  const since = getQuery(event).since
  // The last links at once (read again behind them): see readBoardLinks.
  return readBoardLinks(typeof since === 'string' ? since.slice(0, 64) : undefined, { stale: true })
})
