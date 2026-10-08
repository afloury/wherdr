import { phoneAccess } from '../utils/phone'

// Nouvelle version de wherdr disponible ? (see utils/updates.ts) The Update
// button only for sessions allowed to run it (update.post.ts).
export default defineApi(async (event) => {
  const info = await checkUpdate()
  return { ...info, oneTap: info.oneTap && phoneAccess(event) }
})
