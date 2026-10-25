import { coordinatorAutopilot } from '../../utils/projectsTasks'

// { machine, to, action: 'on' | 'off', goal?, every?, tasksPerDay?, tasksAtOnce? }
// Answers with the coordinator's state as read back after the command.
export default defineApi((_event, b) => coordinatorAutopilot(b.machine ?? '', b.to, b))
