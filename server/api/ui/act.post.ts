// { id, cancel? }: the user clicks an action button (or Cancel) in the chat (server/utils/uiActions.ts).
// A request with a token (an agent's CLI) is refused.
import { coreAdminDeps } from '../../utils/coreAdminDeps'
import { applyProposedChange } from '../../utils/alfredCli'
import { actOnCard } from '../../utils/uiActions'
import { coordinatorUrls } from '../../utils/pmCoordinator'
import { pmFolderCheck } from '../../utils/pmFolder'
import { pmStore } from '../../utils/pmStore'

export default defineApi(async (event, body) => {
  const deps = { ...coreAdminDeps(), store: pmStore(), origin: getRequestURL(event).origin }
  const applyChange = (argv: string[], lines: string[]) => applyProposedChange({ ...deps, check: pmFolderCheck, urls: coordinatorUrls(getRequestURL(event)) }, argv, lines)
  return { card: await actOnCard({ ...deps, applyChange }, body.id, getRequestHeader(event, 'authorization'), body.cancel === true) }
})
