import { createAgentCommands } from '../utils/agentCommands'
import { coreInputDeps } from '../utils/coreInput'

// The slash commands and skills of an omp or Claude Code terminal, for the composer's "/" list:
// asked of the agent on the terminal's machine and in its folder (utils/agentCommands.ts), kept
// a minute. Any other agent: an empty list.
const commands = createAgentCommands(coreInputDeps())

export default defineApi(async event => commands.list(String(getQuery(event).pane || '')))
