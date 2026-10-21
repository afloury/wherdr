// Stop a task waiting for others: `{ machine, id }` → `herdr-projects after <id> --clear`.
import { clearTaskAfter } from '../../utils/projectsTasks'

export default defineApi((_event, b) => clearTaskAfter(b.machine ?? '', b.id))
