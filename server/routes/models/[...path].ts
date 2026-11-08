// On-device dictation files (DATA_DIR/models/**): models and WASM runtimes,
// downloaded by the browser in resumable Range slices (server/utils/modelFiles.ts).
import path from 'node:path'

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return sendError(event, 405, { error: 'Method not allowed' })
  return serveModelFile(path.join(DATA_DIR, 'models'), getRouterParam(event, 'path') || '',
    { method: event.method, range: getRequestHeader(event, 'range') })
})
