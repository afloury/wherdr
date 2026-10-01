// Installs the Claude quota status line on a machine (see utils/quotas.ts).
import { MACHINE_KEY_RE } from '../../shared/ids'
import { HerdrError } from '../utils/herdr'
import { getMachine } from '../utils/machines'
import { installClaudeStatusline } from '../utils/quotas'

export default defineApi(async (_event, body) => {
  const key = typeof body.key === 'string' ? body.key : null
  const m = key !== null && (key === '' || MACHINE_KEY_RE.test(key)) ? getMachine(key) : undefined
  if (!m) throw new HerdrError('bad_machine', 'machine inconnue')
  return { ok: true, output: await installClaudeStatusline(m) }
})
