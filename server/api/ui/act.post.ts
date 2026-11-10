// { id, cancel? }: the user clicks an action button (or Cancel) in the chat (server/utils/uiActions.ts).
// A request with a token (an agent's CLI) is refused.
import { coreAdminDeps } from '../../utils/coreAdminDeps'
import { actOnCard } from '../../utils/uiActions'
import { pmStore } from '../../utils/pmStore'

export default defineApi(async (event, body) => ({
  card: await actOnCard({ ...coreAdminDeps(), store: pmStore(), origin: getRequestURL(event).origin }, body.id, getRequestHeader(event, 'authorization'), body.cancel === true),
}))
