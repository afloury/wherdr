import { HerdrError } from '../../utils/herdr'
import { retryMachine } from '../../utils/machines'

// Interactive SSH approval belongs in the user's terminal, never in this process.
export default defineApi(async (_event, body) => {
  if (typeof body.key !== 'string') throw new HerdrError('bad_machine', 'unknown remote machine')
  retryMachine(body.key)
  return { ok: true }
})
