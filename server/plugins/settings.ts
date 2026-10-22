// Settings changed on one device: pushed at once to every open app
// (/ws/events), which applies them without reloading.
import { onSettingsChange } from '../utils/settings'

export default defineNitroPlugin(() => {
  onSettingsChange((changed) => {
    const message = JSON.stringify({ type: 'settings', settings: changed })
    for (const c of eventClients.values()) {
      try { c.send(message) }
      catch { /* client gone */ }
    }
  })
})
