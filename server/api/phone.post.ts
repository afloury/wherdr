import { phoneAction } from '../utils/phone'

export default defineApi(async (_event, body) => phoneAction(body || {}))
