// Core-mode routes added by v3 project management (lot 7: board and task sheet). See shared/coreRoutes.ts.
// GET pm/handle: the tasks waiting for the user, for the sidebar's Tasks to handle (WHR-52).
// GET pm/agents: each running task agent's task and role, for its sidebar row (WHR-82).
// pm/task-check: Check on GitHub, a stuck merge step's PR read now (WHR-114).
// pm/review-restart: Restart the review, a review that stopped without a verdict (WHR-272).
export default ['GET pm/board', 'GET pm/handle', 'GET pm/agents', 'pm/step-user', 'pm/step-back', 'pm/report', 'pm/task-check', 'pm/review-restart'] as string[]
