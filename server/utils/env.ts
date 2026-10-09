// Settings read from the environment (same variables as the old server.js).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PANE_RE as SHARED_PANE_RE } from '../../shared/ids'

const env = process.env

export const HOME = env.HOME || os.homedir()
// In the Docker container (host HOME mounted read-only, see docker-compose.yml).
export const IN_DOCKER = fs.existsSync('/.dockerenv')
export const DATA_DIR = env.DATA_DIR || path.join(process.cwd(), 'data')
// herdr.dev installer: ~/.local/bin; otherwise (Homebrew…) the one on the PATH.
const LOCAL_HERDR = path.join(HOME, '.local/bin/herdr')
export const HERDR_BIN = env.HERDR_BIN || (fs.existsSync(LOCAL_HERDR) ? LOCAL_HERDR : 'herdr')
// Named session for tests (`herdr --session hwtest server`); empty = default session,
// the one the `herdr` client also attaches to.
// (Not `HERDR_SESSION`: Herdr reads that variable itself, and refuses to start when it is empty.)
export const HERDR_SESSION = env.HERDR_WEB_SESSION || ''
export const HERDR_SOCK = env.HERDR_SOCK || (HERDR_SESSION
  ? path.join(HOME, '.config/herdr/sessions', HERDR_SESSION, 'herdr.sock')
  : path.join(HOME, '.config/herdr/herdr.sock'))
// Client socket (attached herdr, shell clients): next to the API socket.
// wherdr connects to it as a passive client to receive `herdr notification show`.
export const HERDR_CLIENT_SOCK = env.HERDR_CLIENT_SOCK || path.join(path.dirname(HERDR_SOCK), 'herdr-client.sock')
// HERDR_WEB_HERDR_NOTIFICATIONS=off: do not relay these notifications as push.
export const NOTICES_ENABLED = !/^(0|off|false|no|non)$/i.test((env.HERDR_WEB_HERDR_NOTIFICATIONS || '').trim())
export const SESSION_ARGS = HERDR_SESSION ? ['--session', HERDR_SESSION] : []
// The herdr CLI is also configured by HERDR_* variables: we pass it
// none, the session is chosen explicitly with --session.
export const HERDR_CHILD_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(env).filter(([k]) => !k.startsWith('HERDR_')),
)
export const AGENT_KINDS = (env.AGENT_KINDS || 'pi,claude,codex,gemini,cursor,devin,agy,cline,omp,mastracode,opencode,copilot,kimi,kiro,droid,amp,grok,hermes,kilo,qodercli,qwen,letta,maki,muse').split(',').map(s => s.trim()).filter(Boolean)
// Public address of the app. Push only uses HTTPS URLs as the VAPID subject.
// An HTTPS APP_URL in the environment wins; otherwise the phone address saved
// by Settings › Phone (DATA_DIR/app-url.json) is used, from startup on.
// process.env.APP_URL holds the address in use (hosts.ts reads it too).
export const APP_URL_FILE = path.join(DATA_DIR, 'app-url.json')
export const ENV_APP_URL = /^https:\/\//i.test(env.APP_URL || '') ? env.APP_URL! : ''
// APP_URL as the environment gave it (often http://localhost:<port>/): what
// comes back when the saved phone address is forgotten.
export const BOOT_APP_URL = env.APP_URL || ''
export function savedAppUrl(): string {
  try {
    const url = JSON.parse(fs.readFileSync(APP_URL_FILE, 'utf8'))?.url
    return typeof url === 'string' && /^https:\/\//i.test(url) ? url : ''
  } catch { return '' }
}
if (!ENV_APP_URL && savedAppUrl()) env.APP_URL = savedAppUrl()
export const appUrl = () => env.APP_URL || 'mailto:herdr-web@localhost'
// Machine name shown in the app ("<HOST_LABEL> · herdr"); empty = "herdr".
export const HOST_LABEL = (env.HOST_LABEL || os.hostname()).trim().slice(0, 40)
// User name of the passkeys created by the app.
export const PASSKEY_USER = (env.PASSKEY_USER || 'wherdr').trim().slice(0, 64)
export const POLL_MS = Number(env.POLL_MS || 1000)
// How often the addresses `tailscale serve` publishes for wherdr are read
// again (server/utils/phone.ts): a new one is enabled, a removed one refused.
export const TAILNET_REFRESH_MS = Number(env.TAILNET_REFRESH_MS || 30000)
// Confirmation delay before notifying: an agent's state may flicker
// (working -> idle -> working between two tools).
export const NOTIFY_SETTLE_MS = Number(env.NOTIFY_SETTLE_MS || 4000)
// Photos sent from the phone: the agent reads them by their path on the host.
export const UPLOAD_DIR = env.UPLOAD_DIR || path.join(HOME, '.cache/herdr-web/uploads')
export const UPLOAD_MAX = 20 * 1024 * 1024
export const UPLOAD_TTL_MS = 7 * 86400000
// Other files attached to a message (PDF, text, code…): same 7-day purge.
export const ATTACH_DIR = env.ATTACH_DIR || path.join(HOME, '.cache/herdr-web/files')
// Arguments to "resume the last conversation" at launch.
export const RESUME_ARGS: Record<string, string[]> = { claude: ['--continue'], codex: ['resume', '--last'] }

// Herdr identifiers: w1…w9, wA, wB… (not only digits), prefixed with
// "<machine>~" for a remote machine (see shared/ids.ts).
export const PANE_RE = SHARED_PANE_RE

// ---------------------------------------------------------------- multi-machine
// Remote machines: Herdr SSH profiles (`herdr machine list`), re-read
// periodically. HERDR_WEB_MACHINES=off to stick to the local machine.
export const MACHINES_ENABLED = !/^(0|off|false|no|non)$/i.test((env.HERDR_WEB_MACHINES || '').trim())
export const MACHINES_REFRESH_MS = Number(env.MACHINES_REFRESH_MS || 30000)
// Herdr session targeted on remote machines instead of the profile's
// (tests: `hwtest`). Empty = the profile's (usually `default`).
export const REMOTE_SESSION = (env.HERDR_WEB_REMOTE_SESSION || '').trim()
export const SSH_BIN = env.SSH_BIN || 'ssh'
// Other names / addresses of this machine (e.g. its Tailscale IP): Herdr profiles
// pointing at it are ignored (in addition to HOST_LABEL, localhost…).
export const SELF_HOSTS = (env.HERDR_WEB_SELF_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)
// SSH sockets (ControlMaster masters, forwarded Herdr sockets): writable, short folder
// (a Unix socket path is limited to ~104 bytes).
export const RUNTIME_DIR = env.WHERDR_RUNTIME_DIR || '/tmp/wherdr'
// Photo store on remote machines, relative to their $HOME.
export const REMOTE_UPLOAD_SUBDIR = '.cache/herdr-web/uploads'

// "Reveal in Finder" / "Open" / "Open in editor" on a Mac that runs wherdr in a Linux
// container (Docker on macOS): `open` does not exist there, so the reveal script is run
// on the host through this SSH target (e.g. `host.docker.internal`, the OrbStack bridge
// user). Wherdr connects with its own key pair (HOST_OPEN_KEY, mounted read-write so a
// host-side setup script can install the public half), and the Mac side decides what the
// key may run: a forced command in authorized_keys (scripts/wherdr-open.sh, installed by
// scripts/install-host-open.sh) only opens paths under the Mac user's home. Empty
// (default): no host route, a non-Mac local machine reports "not a Mac" as before.
export const HOST_OPEN_TARGET = (env.HERDR_WEB_HOST_OPEN_TARGET || '').trim()
export const HOST_OPEN_USER = (env.HERDR_WEB_HOST_OPEN_USER || '').trim()
export const HOST_OPEN_KEY = (env.HERDR_WEB_HOST_OPEN_KEY || path.join(DATA_DIR, 'host-open-key')).trim()

export const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
