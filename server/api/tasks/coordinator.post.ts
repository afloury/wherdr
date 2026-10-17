// A message to a machine's Coordinator: `{ machine, text }` (`herdr-projects coordinator tell`).
import { tellCoordinator } from '../../utils/projectsTasks'

export default defineApi((_event, b) => tellCoordinator(b.machine ?? '', b.text))
