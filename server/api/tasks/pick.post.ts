import { pickTask } from '../../utils/projectsTasks'

export default defineApi((_event, b) => pickTask(b.machine ?? '', b.id, b.letter, b.confirmed))
