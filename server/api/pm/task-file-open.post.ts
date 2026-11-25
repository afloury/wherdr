// { task, root, rel }: a file of a task (found by pm/task-files) in the default
// application of this computer, like a double-click. Only from a browser on it.
import { openTaskFile } from '../../utils/pmTaskFiles'
import { requestOnThisComputer } from '../../utils/requestOnThisComputer'

export default defineApi((event, body) => openTaskFile(body, requestOnThisComputer(event)))
