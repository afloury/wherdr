// A message to a task's agent: `{ machine, id, text }` (`herdr-projects tell`).
import { tellTask } from '../../utils/projectsTasks'

export default defineApi((_event, b) => tellTask(b.machine ?? '', b.id, b.text))
