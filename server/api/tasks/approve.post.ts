// Merges finished work, or says yes to a plan: `{ machine, id }` (`herdr-projects approve`).
import { approveTask } from '../../utils/projectsTasks'

export default defineApi((_event, b) => approveTask(b.machine ?? '', b.id))
