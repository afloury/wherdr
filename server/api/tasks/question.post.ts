import { askTaskCoordinator } from '../../utils/projectsTasks'

export default defineApi((_event, b) => askTaskCoordinator(b.machine ?? '', b.id, b.text))
