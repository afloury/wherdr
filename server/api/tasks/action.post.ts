// A task command that takes only the task's id: `{ machine, id, action, agent? }`,
// action `delegate`, `stop`, `retry` or `archive` (`herdr-projects <action>`).
// `agent`: Start only, that agent for this start (`--worker.agent`).
import { taskCommand } from '../../utils/projectsTasks'

export default defineApi((_event, b) => taskCommand(b.machine ?? '', b.id, b.action, b.agent))
