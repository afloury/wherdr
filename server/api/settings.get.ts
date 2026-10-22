import { readSettings } from '../utils/settings'

export default defineApi(async () => ({ settings: await readSettings() }))
