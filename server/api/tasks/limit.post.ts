// Raise the limit that stopped a task: `{ machine, id, kind, value }` →
// `herdr-projects set limit.<kind> <value> --task <id>` (it carries on by itself).
import { setTaskLimit } from '../../utils/projectsTasks'

export default defineApi((_event, b) => setTaskLimit(b.machine ?? '', b.id, b.kind, b.value))
