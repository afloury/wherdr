import pkg from '../../package.json'

// Liveness and version, without the lock (server/middleware/guard.ts): the
// one-tap updater (bin/lib/updater.mjs) checks that the new version answers.
export default defineEventHandler(() => ({ ok: true, version: pkg.version }))
