// Réglages lus dans l'environnement (mêmes variables que l'ancien server.js).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PANE_RE as SHARED_PANE_RE } from '../../shared/ids'

const env = process.env

export const HOME = env.HOME || os.homedir()
// Dans le conteneur Docker (HOME de l'hôte monté en lecture seule, cf. docker-compose.yml).
export const IN_DOCKER = fs.existsSync('/.dockerenv')
export const DATA_DIR = env.DATA_DIR || path.join(process.cwd(), 'data')
// Installateur de herdr.dev : ~/.local/bin ; sinon (Homebrew…) celui du PATH.
const LOCAL_HERDR = path.join(HOME, '.local/bin/herdr')
export const HERDR_BIN = env.HERDR_BIN || (fs.existsSync(LOCAL_HERDR) ? LOCAL_HERDR : 'herdr')
// Session nommée pour les tests (`herdr --session hwtest server`) ; vide = session par défaut,
// celle à laquelle le client `herdr` s'attache aussi.
// (Pas `HERDR_SESSION` : Herdr lit lui-même cette variable, et vide il refuse de démarrer.)
export const HERDR_SESSION = env.HERDR_WEB_SESSION || ''
export const HERDR_SOCK = env.HERDR_SOCK || (HERDR_SESSION
  ? path.join(HOME, '.config/herdr/sessions', HERDR_SESSION, 'herdr.sock')
  : path.join(HOME, '.config/herdr/herdr.sock'))
// Socket des clients (herdr attaché, clients shell) : à côté du socket API.
// wherdr s'y connecte en client passif pour recevoir `herdr notification show`.
export const HERDR_CLIENT_SOCK = env.HERDR_CLIENT_SOCK || path.join(path.dirname(HERDR_SOCK), 'herdr-client.sock')
// HERDR_WEB_HERDR_NOTIFICATIONS=off : ne pas relayer ces notifications en push.
export const NOTICES_ENABLED = !/^(0|off|false|no|non)$/i.test((env.HERDR_WEB_HERDR_NOTIFICATIONS || '').trim())
export const SESSION_ARGS = HERDR_SESSION ? ['--session', HERDR_SESSION] : []
// Le CLI herdr se configure aussi par variables HERDR_* : on ne lui en passe
// aucune, la session est choisie explicitement par --session.
export const HERDR_CHILD_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(env).filter(([k]) => !k.startsWith('HERDR_')),
)
export const AGENT_KINDS = (env.AGENT_KINDS || 'pi,claude,codex,gemini,cursor,devin,agy,cline,omp,mastracode,opencode,copilot,kimi,kiro,droid,amp,grok,hermes,kilo,qodercli,qwen,letta,maki,muse').split(',').map(s => s.trim()).filter(Boolean)
// Adresse publique de l'app. Le push n'utilise que les URL HTTPS comme sujet VAPID.
export const APP_URL = env.APP_URL || 'mailto:herdr-web@localhost'
// Nom de la machine affiché dans l'app (« <HOST_LABEL> · herdr ») ; vide = « herdr ».
export const HOST_LABEL = (env.HOST_LABEL || os.hostname()).trim().slice(0, 40)
// Nom d'utilisateur des clés d'accès (passkeys) créées par l'app.
export const PASSKEY_USER = (env.PASSKEY_USER || 'wherdr').trim().slice(0, 64)
export const POLL_MS = Number(env.POLL_MS || 1000)
// Délai de confirmation avant de notifier : l'état d'un agent peut clignoter
// (working -> idle -> working entre deux outils).
export const NOTIFY_SETTLE_MS = Number(env.NOTIFY_SETTLE_MS || 4000)
// Photos envoyées depuis le téléphone : l'agent les lit par leur chemin sur l'hôte.
export const UPLOAD_DIR = env.UPLOAD_DIR || path.join(HOME, '.cache/herdr-web/uploads')
export const UPLOAD_MAX = 20 * 1024 * 1024
export const UPLOAD_TTL_MS = 7 * 86400000
// Arguments pour « reprendre la dernière conversation » au lancement.
export const RESUME_ARGS: Record<string, string[]> = { claude: ['--continue'], codex: ['resume', '--last'] }

// Identifiants Herdr : w1…w9, wA, wB… (pas seulement des chiffres), préfixés
// « <machine>~ » pour une machine distante (cf. shared/ids.ts).
export const PANE_RE = SHARED_PANE_RE

// ---------------------------------------------------------------- multi-machines
// Machines distantes : profils SSH de Herdr (`herdr machine list`), relus
// périodiquement. HERDR_WEB_MACHINES=off pour s'en tenir à la machine locale.
export const MACHINES_ENABLED = !/^(0|off|false|no|non)$/i.test((env.HERDR_WEB_MACHINES || '').trim())
export const MACHINES_REFRESH_MS = Number(env.MACHINES_REFRESH_MS || 30000)
// Session Herdr visée sur les machines distantes à la place de celle du profil
// (tests : `hwtest`). Vide = celle du profil (en général `default`).
export const REMOTE_SESSION = (env.HERDR_WEB_REMOTE_SESSION || '').trim()
export const SSH_BIN = env.SSH_BIN || 'ssh'
// Autres noms / adresses de cette machine (ex. son IP Tailscale) : les profils
// Herdr qui la visent sont ignorés (en plus de HOST_LABEL, localhost…).
export const SELF_HOSTS = (env.HERDR_WEB_SELF_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)
// Sockets SSH (maîtres ControlMaster, sockets Herdr transférés) : dossier inscriptible, court
// (un chemin de socket Unix est limité à ~104 octets).
export const RUNTIME_DIR = env.WHERDR_RUNTIME_DIR || '/tmp/wherdr'
// Dépôt des photos sur les machines distantes, relatif à leur $HOME.
export const REMOTE_UPLOAD_SUBDIR = '.cache/herdr-web/uploads'

export const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
