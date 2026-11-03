// Core-mode routes added by lot A (WHR-244). See shared/coreRoutes.ts.
// Phone address (independent of the backend); version info, read-only: the
// one-tap self-update (POST /api/update) stays refused.
export default ['phone', 'GET update'] as string[]
