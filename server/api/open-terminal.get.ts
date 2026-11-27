// Whether this browser is on the computer wherdr runs on: "Open in my terminal" is offered only then.
import { requestOnThisComputer } from '../utils/openTerminalClient'

export default defineApi(event => ({ available: requestOnThisComputer(event) }))
