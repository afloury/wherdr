// "Open in file manager": a folder from a conversation in the desktop's file
// manager, on this computer (server/utils/openTerminal.ts). Same rules as
// "Open in my terminal".
import { openFileManager } from '../utils/openTerminal'
import { requestOnThisComputer } from '../utils/openTerminalClient'

export default defineApi((event, b) => openFileManager(b, requestOnThisComputer(event)))
