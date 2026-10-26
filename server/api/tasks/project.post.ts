// A project coordinator's repo on the board, its folder added first when the
// board does not know it: `{ machine, folder }` -> `{ repo, root, added }`.
import { registerProject } from '../../utils/projectsTasks'

export default defineApi((_event, b) => registerProject(b.machine ?? '', b.folder))
