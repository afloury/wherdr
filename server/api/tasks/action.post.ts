// A task command that takes only the task's id: `{ machine, id, action }`,
// action `delegate`, `stop`, `retry` or `archive` (`herdr-projects <action>`).
import { taskCommand } from '../../utils/projectsTasks'

export default defineApi((_event, b) => taskCommand(b.machine ?? '', b.id, b.action))
