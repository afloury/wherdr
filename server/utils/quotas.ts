// Quotas d'utilisation des comptes Claude et Codex, pour l'accueil. Lecture
// passive, sans rien taper dans les agents :
//  - Codex écrit ses limites dans ses conversations (événement token_count,
//    `rate_limits` : fenêtre de 5 h et semaine) ;
//  - Claude Code les donne à sa barre d'état ; une barre d'état invisible
//    (installée par scripts/install-claude-statusline.sh, cf. installClaudeStatusline)
//    les garde dans ~/.cache/herdr-web/claude-status.json.
// Les quotas valent pour tout le compte : sur plusieurs machines, on garde la
// lecture la plus récente de chaque compte. Claude : la barre d'état garde aussi
// une empreinte du compte (claude-account, hash tronqué de son identifiant, jamais
// l'identifiant lui-même) ; des machines sur des comptes différents ont alors
// chacune leur bloc (claudeAccounts), affiché sous leur machine par l'app.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { AccountQuota, ClaudeSetup, Quota, QuotaWindow, Quotas } from '../../shared/types'
import type { ExecResult, MachineFs } from './fsx'
import { HerdrError } from './herdr'
import { allMachines, type Machine } from './machines'

const TTL = 30000
let cache: { at: number, q: Quotas } | null = null

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const win = (used: unknown, resets: unknown, minutes: number): QuotaWindow | null => {
  const u = Number(used)
  if (!Number.isFinite(u)) return null
  return { used: Math.max(0, Math.min(100, u)), resetsAt: Number(resets) ? Number(resets) * 1000 : null, minutes }
}

// Heure de réinitialisation impossible (plus loin que la durée de la fenêtre
// après la lecture, à 10 min près : mauvais champ, horloge) : inconnue plutôt
// qu'une date trompeuse.
function plausible(w: QuotaWindow | null, at: number): QuotaWindow | null {
  if (!w || !w.resetsAt || !w.minutes || !at) return w
  return w.resetsAt > at + (w.minutes + 10) * 60000 ? { ...w, resetsAt: null } : w
}
const quota = (five: QuotaWindow | null, week: QuotaWindow | null, at: number): Quota | null =>
  five || week ? { five: plausible(five, at), week: plausible(week, at), at } : null

export function claudeQuota(status: Json, at: number): Quota | null {
  const r = status && status.rate_limits
  if (!r) return null
  // Juste après la fin d'une fenêtre (5 h ou semaine), Claude ne transmet que
  // l'autre : une nouvelle fenêtre commence, rien n'y est encore utilisé.
  const five = r.five_hour ? win(r.five_hour.used_percentage, r.five_hour.resets_at, 300) : null
  const week = r.seven_day ? win(r.seven_day.used_percentage, r.seven_day.resets_at, 10080) : null
  const fresh = (minutes: number): QuotaWindow => ({ used: 0, resetsAt: null, minutes, fresh: true })
  if (five && !week) return quota(five, fresh(10080), at)
  if (week && !five) return quota(fresh(300), week, at)
  return quota(five, week, at)
}

// Codex, lui, n'omet pas une fenêtre qui repart (il la donne à 0 %) : une fenêtre
// absente est absente du forfait (Plus : semaine seule ; gratuit : 30 jours).
export function codexQuota(rl: Json, at: number): Quota | null {
  if (!rl) return null
  const pick = (w: Json | null | undefined) => (w ? win(w.used_percent, w.resets_at, Number(w.window_minutes) || 0) : null)
  // primary = fenêtre courte (5 h), secondary = semaine ; on s'appuie sur la durée.
  const ws = [pick(rl.primary), pick(rl.secondary)].filter(Boolean) as QuotaWindow[]
  const five = ws.find(w => w.minutes && w.minutes < 1440) || null
  const week = ws.find(w => w.minutes >= 1440) || null
  return quota(five, week, at)
}

// Dernière ligne `rate_limits` d'une conversation Codex (lue par la fin).
export function lastCodexLimits(text: string): { rl: Json, at: number } | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!
    if (!l.includes('"rate_limits"')) continue
    try {
      const d = JSON.parse(l)
      const rl = d.payload && d.payload.rate_limits
      if (rl && (rl.primary || rl.secondary)) return { rl, at: Date.parse(d.timestamp) || 0 }
    } catch { /* ligne coupée */ }
  }
  return null
}

async function ls(fs: MachineFs, d: string) {
  try { return await fs.readdir(d) }
  catch { return [] }
}

// Lecture Claude d'une machine, avec l'empreinte de son compte si connue.
export type ClaudeReading = Quota & { account: string | null }

// Barre d'état de wherdr en place sur une machine ? `ok` : lecture complète
// (quotas + empreinte), ou un compte sans quotas (clé d'API : rien à montrer).
// Sinon, `pending` si la barre d'état à jour (avec empreinte) est branchée dans
// settings.json — les quotas viendront au prochain échange —, `missing` sinon.
export function claudeSetupState(f: { status: Json | null, account: boolean, statusline: string | null, settings: string | null }): 'ok' | ClaudeSetup['state'] {
  if (f.status && (!f.status.rate_limits || f.account)) return 'ok'
  const installed = Boolean(f.statusline?.includes('claude-account') && f.settings?.includes('wherdr-statusline.sh'))
  if (installed) return f.status ? 'ok' : 'pending' // à jour, mais pas d'empreinte lisible : rien de plus à faire
  return 'missing'
}

async function readClaude(fs: MachineFs, home: string): Promise<{ q: ClaudeReading | null, setup: 'ok' | ClaudeSetup['state'] }> {
  const dir = path.posix.join(home, '.cache/herdr-web')
  const f = path.posix.join(dir, 'claude-status.json')
  const text = (p: string) => fs.readFile(p).catch(() => null)
  let status: Json | null = null
  let at = 0
  try {
    at = (await fs.stat(f)).mtimeMs
    status = JSON.parse(await fs.readFile(f))
  } catch { status = null }
  const acc = (await text(path.posix.join(dir, 'claude-account')))?.trim() || ''
  const account = /^[0-9a-f]{16,64}$/.test(acc) ? acc : null
  const setup = claudeSetupState(status && account
    ? { status, account: true, statusline: null, settings: null }
    : {
        status, account: Boolean(account),
        statusline: await text(path.posix.join(home, '.claude/wherdr-statusline.sh')),
        settings: await text(path.posix.join(home, '.claude/settings.json')),
      })
  const q = status ? claudeQuota(status, at) : null
  return { q: q ? { ...q, account } : null, setup }
}

// Même compte ? Les empreintes si les deux machines en ont une ; sinon l'heure de
// réinitialisation hebdomadaire, fixe pour un compte (comparée modulo une
// semaine, une lecture ancienne pouvant dater d'une semaine précédente) ; sans
// rien de comparable, on suppose le même compte (affichage d'avant).
const WEEK_MS = 7 * 86400000
export function sameAccount(a: ClaudeReading, b: ClaudeReading): boolean {
  if (a.account && b.account) return a.account === b.account
  const x = a.week?.resetsAt
  const y = b.week?.resetsAt
  if (!x || !y) return true
  const d = (((x - y) % WEEK_MS) + WEEK_MS) % WEEK_MS
  return Math.min(d, WEEK_MS - d) <= 5 * 60000
}

// Regroupe les lectures par compte : la plus récente de chaque compte, avec ses
// machines dans l'ordre reçu. Le groupe est comparé à sa première lecture qui a
// une empreinte (à défaut, sa première lecture).
export function groupAccounts(list: { key: string, label: string, q: ClaudeReading }[]): AccountQuota[] {
  const groups: { rep: ClaudeReading, best: ClaudeReading, machines: { key: string, label: string }[] }[] = []
  for (const { key, label, q } of list) {
    const g = groups.find(g => sameAccount(g.rep, q))
    if (!g) { groups.push({ rep: q, best: q, machines: [{ key, label }] }); continue }
    g.machines.push({ key, label })
    if (q.at > g.best.at) g.best = q
    if (!g.rep.account && q.account) g.rep = q
  }
  return groups.map(({ best: { account: _, ...q }, machines }) => ({ ...q, machines }))
}

// Plusieurs conversations Codex écrivent les limites du même compte : un vieux
// fichier encore modifié peut porter une valeur ancienne. On garde, par fenêtre,
// la lecture la plus récente (horodatage de la ligne, 0 s'il manque) ; dans la
// même fenêtre (même heure de réinitialisation, à quelques minutes près : elle
// est recalculée à chaque réponse), l'usage ne peut que croître : le plus élevé.
export type CodexReading = { q: Quota, stamp: number }
const SAME_WINDOW = 10 * 60000
function latestWindow(list: { w: QuotaWindow, stamp: number }[]): QuotaWindow | null {
  if (!list.length) return null
  const ref = list.reduce((a, b) => {
    if (b.stamp !== a.stamp) return b.stamp > a.stamp ? b : a
    const d = (b.w.resetsAt || 0) - (a.w.resetsAt || 0)
    return d > SAME_WINDOW || (Math.abs(d) <= SAME_WINDOW && b.w.used > a.w.used) ? b : a
  })
  const r = ref.w.resetsAt
  let used = ref.w.used
  for (const { w } of list) if (r && w.resetsAt && Math.abs(w.resetsAt - r) <= SAME_WINDOW) used = Math.max(used, w.used)
  return { ...ref.w, used }
}
export function latestCodexQuota(readings: CodexReading[]): Quota | null {
  if (!readings.length) return null
  const pick = (k: 'five' | 'week') => latestWindow(readings.flatMap(r => (r.q[k] ? [{ w: r.q[k]!, stamp: r.stamp }] : [])))
  return quota(pick('five'), pick('week'), Math.max(...readings.map(r => r.q.at)))
}

export async function readCodex(fs: MachineFs, home: string): Promise<Quota | null> {
  const root = path.posix.join(home, '.codex/sessions')
  const files: string[] = []
  const now = new Date()
  for (let back = 0; back < 3; back++) {
    const d = new Date(now.getTime() - back * 86400000)
    const dir = path.posix.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    for (const n of await ls(fs, dir)) if (n.startsWith('rollout-') && n.endsWith('.jsonl')) files.push(path.posix.join(dir, n))
  }
  if (!files.length) return null
  const st = await fs.statMany(files)
  const recent = files.map((f, i) => ({ f, s: st[i] })).filter(x => x.s && x.s.isFile)
    .sort((a, b) => b.s!.mtimeMs - a.s!.mtimeMs).slice(0, 6)
  // Fin de chaque fichier : 64 Kio suffisent d'ordinaire (un token_count par
  // réponse), 512 Kio au plus si rien n'y est.
  const readings = await Promise.all(recent.map(async ({ f, s }) => {
    for (const max of [64 * 1024, 512 * 1024]) {
      const len = Math.min(s!.size, max)
      try {
        const hit = lastCodexLimits((await fs.read(f, s!.size - len, len)).toString('utf8'))
        const q = hit && codexQuota(hit.rl, hit.at || s!.mtimeMs)
        if (q) return { q, stamp: hit!.at }
      } catch { return null /* fichier illisible */ }
      if (len === s!.size) break
    }
    return null
  }))
  return latestCodexQuota(readings.filter(Boolean) as CodexReading[])
}

const fresher = (a: Quota | null, b: Quota | null) => (!a ? b : !b ? a : b.at > a.at ? b : a)

// Assemble les lectures des machines en ligne (dans l'ordre des machines).
export function mergeQuotas(readings: { key: string, label: string, claude: ClaudeReading | null, codex: Quota | null, setup?: ClaudeSetup | null }[]): Quotas {
  let codex: Quota | null = null
  for (const r of readings) codex = fresher(codex, r.codex)
  const accounts = groupAccounts(readings.flatMap(r => (r.claude ? [{ key: r.key, label: r.label, q: r.claude }] : [])))
  let claude: Quota | null = null
  for (const { machines: _, ...a } of accounts) claude = fresher(claude, a)
  const out: Quotas = accounts.length > 1 ? { claude, codex, claudeAccounts: accounts } : { claude, codex }
  const setup = readings.flatMap(r => (r.setup ? [r.setup] : []))
  if (setup.length) out.claudeSetup = setup
  return out
}

// Le serveur peut-il écrire dans ~/.claude ? Distante : oui (SSH). Locale : pas
// dans le conteneur, où $HOME est en lecture seule (commande à copier).
async function canInstall(m: Machine): Promise<boolean> {
  if (!m.local) return Boolean(m.exec)
  for (const d of [path.join(m.home, '.claude'), m.home]) {
    try {
      await fs.promises.access(d, fs.constants.W_OK)
      return true
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return false }
  }
  return false
}

export async function readQuotas(force = false): Promise<Quotas> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.q
  const online = allMachines().filter(m => m.home && !m.info().baseKey && (m.local || m.status === 'online'))
  const readings = await Promise.all(online.map(async (m) => {
    const [claude, codex] = await Promise.all([readClaude(m.fs, m.home).catch(() => null), readCodex(m.fs, m.home).catch(() => null)])
    const state = claude?.setup
    const setup = state === 'missing' || state === 'pending' ? { key: m.key, state, installable: await canInstall(m) } : null
    return { key: m.key, label: m.label, claude: claude?.q || null, codex, setup }
  }))
  const q = mergeQuotas(readings)
  cache = { at: Date.now(), q }
  return q
}

// ---------------------------------------------------------------- installation
// Script d'installation (autonome, barre d'état comprise), embarqué au build
// depuis scripts/ (nitro.serverAssets). Passé sur l'entrée standard de `sh -s` :
// jamais recopié dans une ligne de commande.
async function installerScript(): Promise<string> {
  const raw = await useStorage('assets:scripts').getItemRaw('install-claude-statusline.sh')
  const s = raw ? (typeof raw === 'string' ? raw : Buffer.from(raw as ArrayBuffer).toString('utf8')) : ''
  if (!s.startsWith('#!/bin/sh')) throw new HerdrError('no_script', 'script d’installation introuvable')
  return s
}

function runLocal(input: string, home: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-s'], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000)
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => { if (err.length < 4000) err += b.toString('utf8') })
    child.on('error', (e) => { err += e.message })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr: err }) })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

// Installe (ou met à jour) la barre d'état sur une machine en ligne ; renvoie la
// dernière ligne du script (« barre d'état ajoutée : … », « déjà installée : … »).
export async function installClaudeStatusline(m: Machine): Promise<string> {
  if (!m.local && m.status !== 'online') throw new HerdrError('unreachable', `${m.label} injoignable`)
  if (!(await canInstall(m))) throw new HerdrError('read_only', `dossier personnel en lecture seule ici : copie la commande et colle-la dans un terminal de ${m.label}`)
  const script = await installerScript()
  const r = m.local ? await runLocal(script, m.home) : await m.exec!('exec sh -s', [], { input: Buffer.from(script), timeoutMs: 60000 })
  const last = (s: string) => (s.trim().split('\n').filter(Boolean).pop() || '').slice(0, 300)
  if (r.code !== 0) throw new HerdrError('install_failed', `installation impossible sur ${m.label} : ${last(r.stderr) || `code ${r.code}`}`)
  cache = null
  return last(r.stdout.toString('utf8'))
}
