// "Open in my terminal": a folder from a conversation in the default terminal
// app of this computer (see server/utils/openTerminal.ts). Only from a browser
// on this computer: a phone or a remote browser is refused.
import { openTerminal } from '../utils/openTerminal'
import { requestOnThisComputer } from '../utils/openTerminalClient'

export default defineApi((event, b) => openTerminal(b, requestOnThisComputer(event)))
