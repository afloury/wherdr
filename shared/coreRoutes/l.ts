// Core-mode routes added by v3 project management (lot 7: board and task sheet). See shared/coreRoutes.ts.
// GET pm/handle: the tasks waiting for the user, for the sidebar's Tasks to handle (WHR-52).
// pm/task-check: Check on GitHub, a stuck merge step's PR read now (WHR-114).
export default ['GET pm/board', 'GET pm/handle', 'pm/step-user', 'pm/step-back', 'pm/task-check'] as string[]
