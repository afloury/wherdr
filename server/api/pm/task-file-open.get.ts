// Whether this browser is on the task's computer, where a file can open in its default application.
import { requestOnThisComputer } from '../../utils/requestOnThisComputer'

export default defineApi(event => ({ available: requestOnThisComputer(event) }))
