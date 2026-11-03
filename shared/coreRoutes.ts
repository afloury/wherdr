// Routes that answer with herdr-core (WHR-244). One list for the server guard
// (server/middleware/guard.ts) and the client (api() in useHerdr.ts): every
// other /api/ route is "Unavailable with herdr-core". A lot adds its routes in
// its own file, shared/coreRoutes/<lot>.ts, so lots never touch the same lines.
//
// Entry: a path under /api/ without the prefix ('state'), exact; ending with
// '/*' it also covers everything below ('auth/*' = 'auth' and 'auth/login').
// A 'GET ' prefix ('GET update') allows reads only: the route is refused to POST.
import a from './coreRoutes/a'
import b from './coreRoutes/b'
import c from './coreRoutes/c'
import d from './coreRoutes/d'
import e from './coreRoutes/e'
import f from './coreRoutes/f'
import g from './coreRoutes/g'
import h from './coreRoutes/h'
import i from './coreRoutes/i'

const BASE = [
  'auth/*', 'core/*', 'client-plugins/*',
  'state', 'config', 'settings', 'health', 'search',
  'chat', 'chat/image', 'prompt', 'input', 'interrupt', 'close', 'agents',
  'dirs', 'isgit', 'quotas', 'claude-statusline', 'claude-setup',
  'machine/add', 'machine/connect',
  // Open PRs #301, #302, #303 (their lots rebase onto this list).
  'machine/core', 'machine/core-rename', 'machine/core-forget',
  'upload', 'attach', 'file', 'keep',
]

const routes = [...BASE, ...a, ...b, ...c, ...d, ...e, ...f, ...g, ...h, ...i]
const readOnly = routes.filter(r => r.startsWith('GET ')).map(r => r.slice(4))
const open = routes.filter(r => !r.startsWith('GET '))
const exact = new Set(open.filter(r => !r.endsWith('/*')))
const prefixes = open.filter(r => r.endsWith('/*')).map(r => r.slice(0, -2))

/** `path`: '/api/state', with or without a query string; `method`: 'GET' unless told. */
export function coreRouteAllowed(path: string, method = 'GET'): boolean {
  const m = /^\/api\/([^?#]*)/.exec(path)
  if (!m) return false
  const rest = m[1]!
  if (method.toUpperCase() === 'GET' && readOnly.includes(rest)) return true
  return exact.has(rest) || prefixes.some(p => rest === p || rest.startsWith(`${p}/`))
}
