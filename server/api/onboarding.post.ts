import { writeOnboarding } from '../utils/onboarding'

// Setup guide finished or skipped ({ done: true }), or shown again ({ done: false }).
export default defineApi((_event, body) => {
  if (typeof body?.done !== 'boolean') throw new HerdrError('bad_request', 'done must be true or false')
  return writeOnboarding(body.done)
})
