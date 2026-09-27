// Identifiants multi-machines. Les IDs de Herdr (w1, w1:p2, w1:t1…) ne sont
// uniques que sur un serveur : ceux d'une machine distante reçoivent un préfixe
// « <machine>~ » (8 premiers caractères hexadécimaux de son profil Herdr).
// La machine locale n'a pas de préfixe : ses IDs restent ceux d'avant
// (les liens des notifications déjà envoyées, /#/a/w1:p1, restent valables).

export const LOCAL = ''
// Clé courte d'une machine : les 8 premiers caractères de l'ID de profil Herdr.
export const MACHINE_KEY_RE = /^[0-9a-f]{4,32}$/
export const SEP = '~'
// Pane : w1:p1 (local) ou f27df2ea~w1:p1 (distant).
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

// Paramètres d'un appel Herdr qui désignent un objet d'une machine : le routage
// se fait sur le premier trouvé, et les IDs sont rendus locaux.
const ROUTED = ['pane_id', 'target', 'workspace_id', 'tab_id'] as const

export function routeParams(params: Record<string, unknown>): { machine: string | null, params: Record<string, unknown> } {
  let machine: string | null = null
  const out: Record<string, unknown> = { ...params }
  for (const k of ROUTED) {
    const v = out[k]
    if (typeof v !== 'string') continue
    const s = splitId(v)
    if (machine === null) machine = s.machine
    else if (machine !== s.machine) throw new Error(`IDs de machines différentes : ${k}`)
    out[k] = s.local
  }
  return { machine, params: out }
}

// Profils de `herdr machine list --json` -> machines distantes activées.
export interface MachineProfile { key: string, id: string, label: string, target: string, session: string }

// Hôte d'une cible SSH (« user@hote:port », « [::1]:22 ») : minuscules, sans
// utilisateur ni port ni point final ; premier label pour un nom (host-a ==
// host-a.example.ts.net), l'adresse entière pour une IP.
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

// Cible qui désigne la machine locale elle-même (l'ordinateur a souvent le serveur
// dans ses machines, et inversement) : jamais affichée deux fois.
export function isSelfTarget(target: string, selfNames: string[]): boolean {
  const h = targetHost(target)
  if (!h) return false
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(h) || h.startsWith('127.')) return true
  return selfNames.map(n => targetHost(n)).filter(Boolean).includes(h)
}

// `selfNames` : noms et adresses de la machine locale (profils ignorés).
// Profils visant le même hôte et la même session : seul le premier est gardé.
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
    // Cible SSH : pas d'option déguisée (« -oProxyCommand=… »).
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

// Chemin du socket dans la sortie de `herdr status server` (« socket: /…/herdr.sock »).
export function parseStatusSocket(out: string): string | null {
  const m = /^\s*socket:\s*(\S.*?)\s*$/m.exec(String(out || ''))
  return m ? m[1]! : null
}

// Nom d'un agent lancé depuis l'app (normalisé en minuscules).
export const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/
export const AGENT_NAME_HINT = 'nom : minuscules, chiffres, - et _ (32 max), commence par une lettre'
