import { raiseTaskLimit } from '../../utils/projectsTasks'

export default defineApi((_event, b) => raiseTaskLimit(b.machine ?? '', b.id, b.name, b.value))
