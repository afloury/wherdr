// Multi-machine identifiers. Herdr IDs (w1, w1:p2, w1:t1…) are only
// unique on one server: those of a remote machine get a
// "<machine>~" prefix (first 8 hex characters of its Herdr profile).
// The local machine has no prefix: its IDs stay the same as before
// (links in notifications already sent, /#/a/w1:p1, stay valid).

export const LOCAL = ''
// Short key of a machine: the first 8 characters of the Herdr profile ID.
export const MACHINE_KEY_RE = /^[0-9a-f]{4,32}$/
export const SEP = '~'
// Pane : w1:p1 (local) ou 0a1b2c3d~w1:p1 (distant).
export const PANE_RE = /^(?:[0-9a-f]{4,32}~)?w[0-9a-z]+:p[0-9a-z]+$/i

export const machineKey = (profileId: string) => String(profileId || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 8)

export function splitId(id: string): { machine: string, local: string } {
  const s = String(id || '')
  const i = s.indexOf(SEP)
  if (i < 0) return { machine: LOCAL, local: s }
  return { machine: s.slice(0, i), local: s.slice(i + 1) }
}

export const joinId = (machine: string, local: string) => (machine ? `${machine}${SEP}${local}` : local)

export const machineOf = (id: string | null | undefined) => splitId(String(id || '')).machine

// Parameters of a Herdr call that designate an object of a machine: routing
// uses the first one found, and the IDs are made local.
const ROUTED = ['pane_id', 'target', 'workspace_id', 'tab_id'] as const

export function routeParams(params: Record<string, unknown>): { machine: string | null, params: Record<string, unknown> } {
  let machine: string | null = null
  const out: Record<string, unknown> = { ...params }
  for (const k of ROUTED) {
    const v = out[k]
    if (typeof v !== 'string') continue
    const s = splitId(v)
    if (machine === null) machine = s.machine
    else if (machine !== s.machine) throw new Error(`IDs from different machines: ${k}`)
    out[k] = s.local
  }
  return { machine, params: out }
}

// Profiles from `herdr machine list --json` -> enabled remote machines.
export interface MachineProfile { key: string, id: string, label: string, target: string, session: string }

// Host of an SSH target ("user@host:port", "[::1]:22"): lowercase, without
// user, port or trailing dot; first label for a name (host-a ==
// host-a.example.ts.net), the whole address for an IP.
export function targetHost(target: string): string {
  let h = String(target || '').trim().toLowerCase()
  h = h.slice(h.lastIndexOf('@') + 1)
  const v6 = /^\[([^\]]+)\]/.exec(h)
  if (v6) return v6[1]!
  if ((h.match(/:/g) || []).length === 1) h = h.slice(0, h.indexOf(':'))
  h = h.replace(/\.+$/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return h
  return h.split('.')[0] || h
}

// Target that designates the local machine itself (the computer often has the server
// among its machines, and vice versa): never shown twice.
export function isSelfTarget(target: string, selfNames: string[]): boolean {
  const h = targetHost(target)
  if (!h) return false
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(h) || h.startsWith('127.')) return true
  return selfNames.map(n => targetHost(n)).filter(Boolean).includes(h)
}

// `selfNames`: names and addresses of the local machine (profiles ignored).
// Profiles pointing at the same host and session: only the first is kept.
export function parseMachineList(raw: string, selfNames: string[] = []): MachineProfile[] {
  let list: unknown
  try { list = JSON.parse(raw) }
  catch { return [] }
  if (!Array.isArray(list)) return []
  const out: MachineProfile[] = []
  const seen = new Set<string>()
  const hosts = new Set<string>()
  for (const m of list as Record<string, unknown>[]) {
    if (!m || typeof m !== 'object' || m.enabled === false) continue
    const id = String(m.id || '')
    const target = String(m.target || '').trim()
    const key = machineKey(id)
    // SSH target: no disguised option ("-oProxyCommand=…").
    if (key.length < 4 || !target || target.startsWith('-') || /\s/.test(target) || seen.has(key)) continue
    if (isSelfTarget(target, selfNames)) continue
    const rawSession = String(m.session || 'default').trim() || 'default'
    const session = /^[\w.-]{1,64}$/.test(rawSession) ? rawSession : 'default'
    const hostKey = `${targetHost(target)}|${session}`
    if (hosts.has(hostKey)) continue
    hosts.add(hostKey)
    seen.add(key)
    out.push({
      key,
      id,
      label: String(m.label || target).trim().slice(0, 40) || target,
      target,
      session,
    })
  }
  return out
}

// Socket path in the output of `herdr status server` ("socket: /…/herdr.sock").
export function parseStatusSocket(out: string): string | null {
  const m = /^\s*socket:\s*(\S.*?)\s*$/m.exec(String(out || ''))
  return m ? m[1]! : null
}

// Name of an agent launched from the app (normalized to lowercase).
export const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/
export const AGENT_NAME_HINT = 'Name: lowercase letters, digits, - and _ (32 max), starting with a letter'
