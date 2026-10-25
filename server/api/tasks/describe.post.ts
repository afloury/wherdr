import { describeTask } from '../../utils/projectsTasks'

export default defineApi((_event, b) => describeTask(b.machine ?? '', b.id, b.text))
