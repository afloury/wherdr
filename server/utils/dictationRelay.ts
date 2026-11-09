import { createDictation } from './dictation'
import { DATA_DIR } from './env'

// The server's one dictation relay (server/utils/dictation.ts). The
// environment's key, if any, wins over the saved one.
export const dictation = createDictation({ dataDir: DATA_DIR, envKey: process.env.OPENROUTER_API_KEY?.trim() || undefined })
