import { applyWsCompression } from '../utils/wsCompression'

// Runs before the node-server preset hands these options to crossws (see
// server/utils/wsCompression.ts). The object is cached by h3: mutated in place.
export default defineNitroPlugin((nitroApp) => {
  const options = (nitroApp.h3App as unknown as { websocket?: Parameters<typeof applyWsCompression>[0] }).websocket
  if (options) applyWsCompression(options)
})
