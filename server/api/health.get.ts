import pkg from '../../package.json'

// Liveness and version, without the lock (server/middleware/guard.ts): the
// one-tap updater (bin/lib/updater.mjs) checks that the new version answers.
// Unlike the static files, it goes through the host check: the phone address
// probes (bin/lib/tailnet.mjs, the installer, the plugin) ask it to tell
// "wherdr answers here" from "wherdr refuses this address".
export default defineEventHandler(() => ({ ok: true, name: 'wherdr', version: pkg.version }))
