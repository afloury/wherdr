// A new task: `{ machine, title, description?, repo?, delegate?, type?, planApprove? }` (`herdr-projects add`).
import { addTask } from '../../utils/projectsTasks'

export default defineApi((_event, b) => addTask(b.machine ?? '', b))
