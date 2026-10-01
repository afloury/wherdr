import { MACHINE_KEY_RE } from '../../../shared/ids'
import { HerdrError } from '../../utils/herdr'
import { getMachine, renameMachine } from '../../utils/machines'

export default defineApi(async (_event, body) => {
  const key = typeof body.key === 'string' ? body.key : null
  if (key === null || (key !== '' && !MACHINE_KEY_RE.test(key)) || !getMachine(key)) {
    throw new HerdrError('bad_machine', 'unknown machine')
  }
  const label = typeof body.label === 'string' ? body.label.replace(/\s+/g, ' ').trim() : ''
  if (!label || label.length > 40) throw new HerdrError('bad_label', 'Invalid machine name (40 characters max)')
  await renameMachine(key, label)
  return { ok: true, label }
})
