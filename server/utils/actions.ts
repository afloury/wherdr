// Actions : lancer un agent ou un terminal, dossiers, panneaux, photos.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { AGENT_KINDS, DATA_DIR, HOME, RESUME_ARGS, UPLOAD_DIR, UPLOAD_TTL_MS, log } from './env'
import { HerdrError, herdr, herdrOn, sleep } from './herdr'
import { inputVisible } from './choices'
import { addQueued, findPane, pendingPrompts, poll } from './state'
import { type Machine, RemoteMachine, allMachines, getMachine, machineOfPane } from './machines'
import { LIST_DIRS_SCRIPT, listDirsLocal, parseDirList } from './fsx'
import { AGENT_NAME_HINT, AGENT_NAME_RE, PANE_RE, joinId } from '../../shared/ids'
import { safeUploadExtension } from '../../shared/uploadName'
import type { DirListing, MachineConfig } from '../../shared/types'
import { installedAgentKinds } from './agentAvailability'

const fsp = fs.promises
const px = path.posix

// Machine visée par une requête (`machine` : clé courte, vide = locale), prête.
export function machineFor(key: unknown): Machine {
  const m = getMachine(String(key || ''))
  if (!m) throw new HerdrError('bad_machine', 'machine inconnue')
  if (!m.local && (m.status !== 'online' || !m.home)) throw new HerdrError('unreachable', `${m.label} injoignable${m.error ? ` : ${m.error}` : ''}`)
  return m
}

export function underHome(p: unknown, home = HOME): string | null {
  const r = px.resolve(home, String(p || '').replace(/^~(?=$|\/)/, home))
  return r === home || r.startsWith(home + '/') ? r : null
}

export async function isGitRepo(dir: string, m: Machine = getMachine('')!) {
  try {
    await m.fs.stat(px.join(dir, '.git'))
    return true
  } catch { return false }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

// Chemin passé au shell du pane, entre apostrophes.
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export async function createAgent(body: Json) {
  const kind = String(body.kind || '')
  // `shell` : un simple terminal, sans agent.
  if (kind !== 'shell' && !AGENT_KINDS.includes(kind)) throw new HerdrError('bad_kind', `agent inconnu : ${kind}`)
  // Pane existant (terminal tout juste créé par « Diviser ») : l'agent y démarre,
  // sur sa machine et dans son dossier, sans nouveau workspace.
  let target = body.pane_id ? findPane(String(body.pane_id)) : null
  // Pane d'un onglet créé à l'instant (« Nouvel onglet ») : pas encore dans l'état.
  if (body.pane_id && !target && PANE_RE.test(String(body.pane_id))) {
    await poll()
    target = findPane(String(body.pane_id))
  }
  if (body.pane_id) {
    if (!PANE_RE.test(String(body.pane_id)) || !target) throw new HerdrError('bad_pane', 'pane introuvable')
    if (target.agent) throw new HerdrError('busy_pane', 'un agent tourne déjà dans ce pane')
    if (body.worktree) throw new HerdrError('bad_worktree', 'pas de worktree dans un pane existant')
  }
  // Machine où lancer l'agent (locale par défaut).
  const m = machineFor(target ? target.machine || '' : body.machine)
  if (kind !== 'shell' && !(await installedAgentKinds(m)).includes(kind)) throw new HerdrError('not_installed', `${kind} non installé sur ${m.label}`)
  const hx = <T = Json>(method: string, params: Record<string, unknown>, timeoutMs?: number) => herdrOn<T>(m.key, method, params, timeoutMs)
  const gid = (id: string) => joinId(m.key, id)
  const cwd = underHome(body.cwd || (target && target.cwd) || m.home, m.home)
  if (!cwd) throw new HerdrError('bad_cwd', 'le dossier doit être sous ' + m.home)
  try {
    if (!(await m.fs.stat(cwd)).isDir) throw new Error()
  } catch { throw new HerdrError('bad_cwd', `dossier introuvable : ${cwd}`) }

  let name = String(body.name || '').trim().toLowerCase()
  if (name && !AGENT_NAME_RE.test(name)) throw new HerdrError('bad_name', AGENT_NAME_HINT)
  if (!name) name = `${kind}-${crypto.randomBytes(2).toString('hex')}`
  const label = String(body.label || '').trim().slice(0, 40) || px.basename(cwd) || '~'

  // Worktree : l'agent travaille sur sa propre branche, dans un dossier à part
  // (~/.herdr/worktrees/<dépôt>/<branche>), sans toucher au dossier d'origine.
  // Herdr ouvre aussi le dépôt d'origine s'il ne l'est pas, et regroupe les deux.
  let created: Json
  if (body.worktree) {
    if (!(await isGitRepo(cwd, m))) throw new HerdrError('not_git', `pas un dépôt Git : ${cwd}`)
    let branch = String(body.branch || '').trim()
    if (branch && !/^[\w][\w./-]{0,79}$/.test(branch)) throw new HerdrError('bad_branch', 'nom de branche invalide')
    if (!branch) branch = `${kind === 'shell' ? 'shell' : kind}-${crypto.randomBytes(2).toString('hex')}`
    const params = { cwd, branch, label: String(body.label || '').trim() || branch, focus: false, trust_repository: true }
    try {
      created = await hx('worktree.create', params, 30000)
    } catch (e) {
      // Vu une fois juste après un démarrage de Herdr : dépôt pas encore reconnu.
      if ((e as HerdrError).code !== 'not_git_worktree') throw e
      await sleep(1000)
      created = await hx('worktree.create', params, 30000)
    }
  } else if (!target) {
    created = await hx('workspace.create', { cwd, label, focus: false })
  }
  // IDs locaux à la machine -> IDs de l'app (préfixés pour une machine distante).
  const paneId: string = target ? target.id : gid(created.root_pane.pane_id)
  const wsId: string = target ? target.workspace : gid(created.workspace.workspace_id)
  // Pane existant dans un autre dossier que celui choisi : on s'y place d'abord.
  if (target && cwd !== target.cwd) {
    await herdr('pane.send_input', { pane_id: paneId, text: `cd ${shellQuote(cwd)}` })
    await herdr('pane.send_input', { pane_id: paneId, keys: ['enter'] })
  }
  if (kind === 'shell') {
    // Commande de départ : tapée tout de suite, le terminal la garde en tampon
    // jusqu'à ce que le shell affiche son prompt.
    const cmd = String(body.prompt || '').trim()
    if (cmd) {
      await herdr('pane.send_input', { pane_id: paneId, text: cmd })
      await herdr('pane.send_input', { pane_id: paneId, keys: ['enter'] })
    }
    await rememberDir(cwd, m)
    poll()
    return { pane_id: paneId, workspace_id: wsId, name: null }
  }
  // Le serveur Herdr peut avoir un PATH minimal (service, session SSH). Les
  // exécutables détectés dans les dossiers usuels doivent aussi être visibles
  // dans le shell du pane neuf, avant `agent.start`.
  const pathSetup = 'export PATH="$HOME/.local/bin:$HOME/.kimi-code/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"'
  await herdr('pane.send_input', { pane_id: paneId, text: pathSetup })
  await herdr('pane.send_input', { pane_id: paneId, keys: ['enter'] })
  await sleep(400)
  // Le shell du pane tout neuf n'est pas forcément déjà à son prompt :
  // agent.start refuse tant qu'il ne l'est pas, on réessaie quelques secondes.
  let lastErr: HerdrError | null = null
  for (let i = 0; i < 16; i++) {
    try {
      const args = body.resume ? RESUME_ARGS[kind] || [] : []
      await herdr('agent.start', { name, kind, pane_id: paneId, timeout_ms: 60000, ...(args.length ? { args } : {}) }, 75000)
      lastErr = null
      break
    } catch (e) {
      lastErr = e as HerdrError
      if (lastErr.code === 'agent_not_ready') { lastErr = null; break } // démarré mais bloqué (ex. confiance du dossier)
      if (lastErr.code === 'timeout' || lastErr.code === 'unreachable' || /name/i.test(lastErr.code)) break
      await sleep(500)
    }
  }
  if (lastErr) {
    // Le pane existant reste là, en simple terminal.
    if (!target) await herdr('workspace.close', { workspace_id: wsId }).catch(() => {})
    throw lastErr
  }
  // agent.start rend la main avant que l'agent soit prêt (launch_pending), et il
  // peut encore s'arrêter sur une invite (confiance du dossier). Le premier
  // message attend donc son tour : il part au premier état idle.
  if (body.prompt && String(body.prompt).trim()) {
    pendingPrompts.set(paneId, { text: String(body.prompt), at: Date.now() })
    addQueued(paneId, body.prompt)
  }
  await rememberDir(cwd, m)
  poll()
  return { pane_id: paneId, workspace_id: wsId, name }
}

// Dossiers récents : `dirs` pour la machine locale (format d'avant), et
// `machines[<id de profil>]` pour les autres.
const DIRS_FILE = path.join(DATA_DIR, 'dirs.json')
async function readDirsFile(): Promise<{ dirs?: string[], machines?: Record<string, string[]> }> {
  try { return JSON.parse(await fsp.readFile(DIRS_FILE, 'utf8')) || {} }
  catch { return {} }
}
const dirsKey = (m: Machine) => m.profileId || m.key
export async function recentDirs(m: Machine = getMachine('')!): Promise<string[]> {
  const f = await readDirsFile()
  return (m.local ? f.dirs : f.machines && f.machines[dirsKey(m)]) || []
}
async function rememberDir(d: string, m: Machine) {
  const f = await readDirsFile()
  const dirs = [d, ...(await recentDirs(m)).filter(x => x !== d)].slice(0, 12)
  if (m.local) f.dirs = dirs
  else f.machines = { ...(f.machines || {}), [dirsKey(m)]: dirs }
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.writeFile(DIRS_FILE, JSON.stringify(f, null, 2) + '\n')
}

// Machines proposées dans la feuille « Nouveau » (présent seulement s'il y en a plusieurs).
export async function machineConfigs(): Promise<MachineConfig[] | undefined> {
  const ms = allMachines()
  if (ms.length < 2) return undefined
  return Promise.all(ms.map(async m => ({
    key: m.key, label: m.label, local: m.local, home: m.home,
    kinds: m.local || m.status === 'online' ? await installedAgentKinds(m) : [],
    dirs: await recentDirs(m), online: m.local || (m.status === 'online' && Boolean(m.home)),
  })))
}

export async function listDirs(p: string | null, machine: unknown = ''): Promise<DirListing> {
  const m = machineFor(machine)
  const home = m.home
  const dir = underHome(p || home, home)
  if (!dir) throw new HerdrError('bad_path', 'hors de ' + home)
  let raw
  if (m instanceof RemoteMachine) {
    const r = await m.exec(LIST_DIRS_SCRIPT, [dir], { timeoutMs: 15000 })
    if (r.code !== 0) throw new HerdrError('bad_path', `dossier illisible : ${dir}`)
    raw = parseDirList(r.stdout.toString('utf8'))
  } else {
    raw = await listDirsLocal(dir)
  }
  const out = raw.map(e => ({ name: e.name, path: px.join(dir, e.name), git: e.git }))
  out.sort((a, b) => (Number(b.git) - Number(a.git)) || a.name.localeCompare(b.name))
  return { path: dir, parent: dir === home ? null : px.dirname(dir), home, dirs: out }
}

// --- Panneaux ouverts ------------------------------------------------------
// Certaines commandes (/usage, /context all…) ouvrent un panneau plein écran
// qui cache le champ de saisie tant qu'on n'appuie pas sur Échap : un message
// envoyé pendant ce temps est perdu.
// Referme un éventuel panneau d'un agent au repos (jamais pendant qu'il
// travaille : Échap l'interromprait). Renvoie true si un Échap a été envoyé.
export async function closePanel(paneId: string) {
  const p = findPane(paneId)
  if (!p || !p.agent || !['idle', 'done', 'unknown'].includes(p.status || '')) return false
  let sent = false
  for (let i = 0; i < 2; i++) {
    const r = await herdr('pane.read', { pane_id: paneId, source: 'detection' }, 4000)
    if (inputVisible(r.read && r.read.text)) return sent
    await herdr('pane.send_input', { pane_id: paneId, keys: ['esc'] })
    sent = true
    await sleep(400)
  }
  return sent
}

// --- Photos ----------------------------------------------------------------
export const UPLOAD_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' }
// Photo pour un agent d'une machine distante : gardée ici (miniatures de
// l'app, /uploads/<nom>) et copiée sur sa machine, dont on renvoie le chemin.
export async function saveUpload(data: Buffer, ctype: string, paneId?: string | null, requestedExtension?: string) {
  const ext = requestedExtension === undefined ? UPLOAD_TYPES[ctype] : safeUploadExtension(requestedExtension)
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.${ext}`
  const file = path.join(UPLOAD_DIR, name)
  if (!data.length) throw new HerdrError('empty', 'fichier vide')
  const m = paneId ? machineOfPane(paneId) : null
  if (paneId && !m) throw new HerdrError('bad_pane', 'pane introuvable')
  await fsp.mkdir(UPLOAD_DIR, { recursive: true })
  await fsp.writeFile(file, data, { mode: 0o600 })
  if (m instanceof RemoteMachine) {
    if (m.status !== 'online') throw new HerdrError('unreachable', `${m.label} injoignable`)
    const remote = await m.putUpload(name, data)
    log(`photo reçue ${name} (${Math.round(data.length / 1024)} Ko) -> ${m.label}`)
    return { path: remote, name }
  }
  log(`photo reçue ${name} (${Math.round(data.length / 1024)} Ko)`)
  return { path: file, name }
}
export async function cleanUploads() {
  try {
    for (const n of await fsp.readdir(UPLOAD_DIR)) {
      const f = path.join(UPLOAD_DIR, n)
      const st = await fsp.stat(f)
      if (Date.now() - st.mtimeMs > UPLOAD_TTL_MS) await fsp.unlink(f)
    }
  } catch { /* dossier absent */ }
}
// Photo déjà déposée, relue par son nom (jamais hors du dépôt).
export async function readUpload(name: string) {
  if (!/^[\w.-]+\.(jpg|png|webp|gif|heic)$/.test(name)) return null
  const ext = name.split('.').pop()!
  return { type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, body: await fsp.readFile(path.join(UPLOAD_DIR, name)) }
}
