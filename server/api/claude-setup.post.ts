// Claude quota suggestion of machines declined or skipped ({ keys, dismissed: true }),
// or offered again ({ dismissed: false }). See utils/claudeSetup.ts.
import { HerdrError } from '../utils/herdr'
import { writeDismissed } from '../utils/claudeSetup'
import { forgetQuotas } from '../utils/quotas'

export default defineApi((_event, body) => {
  const keys = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === 'string').slice(0, 64) : null
  if (!keys || typeof body?.dismissed !== 'boolean') throw new HerdrError('bad_request', 'keys and dismissed are required')
  const dismissed = writeDismissed(keys, body.dismissed)
  forgetQuotas()
  return { dismissed }
})
