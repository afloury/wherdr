import { openSession } from '../utils/machines'
import { HerdrError } from '../utils/herdr'

export default defineApi(async (_event, body) => {
  if (typeof body.machine !== 'string' || typeof body.name !== 'string') throw new HerdrError('bad_session', 'session invalide')
  return { session: await openSession(body.machine, body.name) }
})
