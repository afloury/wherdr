import { archiveDoneTasks } from '../../utils/projectsTasks'

export default defineApi((_event, b) => archiveDoneTasks(b.machine ?? '', b.repo))
