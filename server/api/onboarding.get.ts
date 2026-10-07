import { readOnboarding } from '../utils/onboarding'

// Setup guide: shown at first launch until finished or skipped (server/utils/onboarding.ts).
export default defineApi(() => readOnboarding())
