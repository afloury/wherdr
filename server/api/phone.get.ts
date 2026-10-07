import { phoneAccess, phoneStatus } from '../utils/phone'

// Settings › Phone: state of the phone address (server/utils/phone.ts).
export default defineApi(async (event) => {
  if (!phoneAccess(event)) return sendError(event, 403, { error: 'Open wherdr on this computer (localhost) or unlock it', code: 'phone_local' })
  return phoneStatus()
})
