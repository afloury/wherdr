// Codex notices of a conversation on screen (see shared/codexStatus.ts):
// "Update available" with an Update button, and the weekly-limit warning.
// Read in the background for a Codex shown on a device, at most every
// STATUS_MS; Codex's own files are re-read at most every FILES_MS per machine.
// The update runs Codex's known official command on the agent's machine
// (`sh -s` over SSH, or locally when its home is writable), never text typed
// into the Codex TUI nor a command read from the screen.
import fs from 'node:fs'
import path from 'node:path'
import type { Pane } from '../../shared/types'
import {
  type CodexScreenInfo, type CodexStatus, type CodexUpdateJob,
  codexUpdateState, codexWeekly, parseCliVersion, parseCodexScreen, parsePackageVersion,
  parseVersionFile, rolloutCliVersion, runningVersion, updateScript,
} from '../../shared/codexStatus'
import type { ExecResult, MachineFs } from './fsx'
import { HerdrError } from './herdr'
import { codexQuota, lastCodexLimits } from './quotas'

const STATUS_MS = 10000
const FILES_MS = 60000
const UPDATE_TIMEOUT_MS = 5 * 60000
// A finished update stays known this long (installed version, failure shown).
const JOB_TTL_MS = 6 * 3600000

export interface CodexMachine {
  key: string
  label: string
  local: boolean
  home: string
  fs: MachineFs
  online: boolean
  exec: ((script: string, input: Buffer, timeoutMs: number) => Promise<ExecResult>) | null
}

export interface CodexStatusDeps {
  machineOf: (paneId: string) => CodexMachine | null
  readScreen: (paneId: string) => Promise<string>
  rolloutOf: (p: Pane) => Promise<string | null>
  runLocal: (script: string, home: string, timeoutMs: number) => Promise<ExecResult>
  writable: (dir: string) => Promise<boolean>
  onChange: () => void
  log: (msg: string) => void
  now?: () => number
}

interface MachineFiles { latest: string | null, dismissed: string | null, installed: string | null, installedAt: number | null, standalone: boolean, canRun: boolean, at: number }
interface RolloutInfo { size: number, version: string | null, week: { used: number, resetsAt: number | null } | null }
type Job = CodexUpdateJob & { started: number }

export function createCodexStatus(d: CodexStatusDeps) {
  const now = d.now ?? Date.now
  const statuses = new Map<string, { status: CodexStatus | null, at: number }>()
  const busy = new Set<string>()
  const files = new Map<string, MachineFiles>()
  const rollouts = new Map<string, RolloutInfo>()
  const jobs = new Map<string, Job>()

  async function machineFiles(m: CodexMachine): Promise<MachineFiles> {
    const old = files.get(m.key)
    if (old && now() - old.at < FILES_MS) return old
    const codex = path.posix.join(m.home, '.codex')
    const read = (f: string) => m.fs.readFile(path.posix.join(codex, f)).catch(() => null)
    const pkgFile = 'packages/standalone/current/codex-package.json'
    const [vf, pkg] = await Promise.all([read('version.json'), read(pkgFile)])
    const { latest, dismissed } = parseVersionFile(vf)
    const installed = parsePackageVersion(pkg)
    let installedAt: number | null = null
    if (installed) {
      try { installedAt = (await m.fs.stat(path.posix.join(codex, pkgFile))).mtimeMs || null }
      catch { installedAt = null }
    }
    // Remote: over SSH. Local: only if ~/.codex can be written (not in the
    // container, whose home is read-only: the command is then copied).
    const canRun = m.local ? await d.writable(codex) : Boolean(m.exec && m.online)
    const f = { latest, dismissed, installed, installedAt, standalone: Boolean(installed), canRun, at: now() }
    files.set(m.key, f)
    return f
  }

  // Rollout of the agent: its `cli_version` (header) and its last weekly reading (tail).
  async function rolloutInfo(m: CodexMachine, file: string | null): Promise<RolloutInfo | null> {
    if (!file) return null
    let size = 0
    try { size = (await m.fs.stat(file)).size }
    catch { return null }
    const old = rollouts.get(file)
    if (old && old.size === size) return old
    let version = old?.version ?? null
    if (!version) {
      for (const max of [64 * 1024, 512 * 1024]) {
        const len = Math.min(size, max)
        const head = (await m.fs.read(file, 0, len).catch(() => Buffer.alloc(0))).toString('utf8')
        if (head.includes('\n') || len === size) { version = rolloutCliVersion(head); break }
      }
    }
    let week: RolloutInfo['week'] = null
    const len = Math.min(size, 256 * 1024)
    const tail = (await m.fs.read(file, size - len, len).catch(() => Buffer.alloc(0))).toString('utf8')
    const hit = lastCodexLimits(tail)
    const q = hit && codexQuota(hit.rl, hit.at)
    if (q && q.week) week = { used: q.week.used, resetsAt: q.week.resetsAt }
    const info = { size, version, week }
    rollouts.set(file, info)
    return info
  }

  function jobOf(key: string): Job | null {
    const j = jobs.get(key)
    if (j && j.phase !== 'running' && now() - j.started > JOB_TTL_MS) { jobs.delete(key); return null }
    return j || null
  }
  const publicJob = (j: Job | null): CodexUpdateJob | null => {
    if (!j) return null
    const { started: _, ...pub } = j
    return pub as CodexUpdateJob
  }

  async function compute(p: Pane): Promise<CodexStatus | null> {
    const m = d.machineOf(p.id)
    if (!m) return null
    const [mf, screenText, file] = await Promise.all([
      machineFiles(m),
      d.readScreen(p.id).catch(() => ''),
      d.rolloutOf(p).catch(() => null),
    ])
    const screen: CodexScreenInfo = parseCodexScreen(screenText)
    const ro = await rolloutInfo(m, file)
    const job = publicJob(jobOf(m.key))
    const running = runningVersion({ rollout: ro?.version ?? null, screen, bornAt: p.bornAt, installed: mf.installed, installedAt: mf.installedAt, job })
    const update = codexUpdateState({ running, latest: mf.latest, dismissed: mf.dismissed, installed: mf.installed, standalone: mf.standalone, screen, canRun: mf.canRun, job })
    const weekly = codexWeekly({ week: ro?.week ?? null, screenLeft: screen.weeklyLeft, now: now() })
    const out: CodexStatus = {}
    if (update) out.update = update
    if (weekly) out.weekly = weekly
    return out.update || out.weekly ? out : null
  }

  function refresh(p: Pane) {
    if (busy.has(p.id)) return
    busy.add(p.id)
    compute(p)
      .catch(() => statuses.get(p.id)?.status ?? null)
      .then((status) => {
        const old = statuses.get(p.id)?.status ?? null
        statuses.set(p.id, { status, at: now() })
        if (JSON.stringify(old) !== JSON.stringify(status)) setTimeout(d.onChange, 0)
      })
      .finally(() => busy.delete(p.id))
  }

  // Status of a Codex on screen (refreshed in the background).
  // The machine's update job is applied right away (no wait for the re-read).
  function statusOf(p: Pane): CodexStatus | null {
    const s = statuses.get(p.id)
    if (!s || now() - s.at >= STATUS_MS) refresh(p)
    const st = s?.status ?? null
    const m = d.machineOf(p.id)
    const job = m ? publicJob(jobOf(m.key)) : null
    if (!job || !st?.update || job.phase === 'done') return st
    return { ...st, update: { ...st.update, job } }
  }
  const stale = (key: string | null) => {
    for (const [id, s] of statuses) if (key === null || d.machineOf(id)?.key === key) s.at = 0
  }

  function forget(paneId: string) { statuses.delete(paneId) }

  // Runs the update on the agent's machine; returns right away, the progress
  // goes through `codexStatus.update.job` of the machine's Codex panes.
  async function startUpdate(p: Pane) {
    const m = d.machineOf(p.id)
    if (!m) throw new HerdrError('bad_pane', 'agent not found')
    if (jobOf(m.key)?.phase === 'running') throw new HerdrError('update_busy', 'Codex update already in progress')
    files.delete(m.key) // fresh versions and rights
    const st = await compute(p)
    const u = st?.update
    if (!u || u.state !== 'available' || !u.command) throw new HerdrError('update_unavailable', 'No Codex update to install')
    if (!u.runnable) throw new HerdrError('update_manual', 'This update cannot be run from wherdr: copy the command')
    const script = updateScript(u.command)
    jobs.set(m.key, { phase: 'running', started: now() })
    d.onChange()
    d.log(`codex update on ${m.label || m.key}: ${u.command}`)
    void (async () => {
      let job: Job
      try {
        const r = m.local ? await d.runLocal(script, m.home, UPDATE_TIMEOUT_MS) : await m.exec!('exec sh -s', Buffer.from(script), UPDATE_TIMEOUT_MS)
        const out = r.stdout.toString('utf8')
        if (r.code !== 0) {
          const last = (r.stderr.trim().split('\n').filter(Boolean).pop() || out.trim().split('\n').pop() || `code ${r.code}`).slice(0, 300)
          job = { phase: 'failed', error: last, started: now() }
        } else {
          const lines = out.trim().split('\n')
          job = { phase: 'done', version: parseCliVersion(lines[lines.length - 1]), at: now(), started: now() }
        }
      } catch (e) { job = { phase: 'failed', error: (e as Error).message, started: now() } }
      jobs.set(m.key, job)
      files.delete(m.key)
      stale(m.key)
      d.log(`codex update on ${m.label || m.key}: ${job.phase}${job.phase === 'failed' ? ` (${job.error})` : ''}`)
      d.onChange()
    })()
    return { command: u.command }
  }

  // Hides a failed update.
  function dismiss(p: Pane) {
    const m = d.machineOf(p.id)
    if (m && jobOf(m.key)?.phase === 'failed') jobs.delete(m.key)
    stale(m ? m.key : null)
    d.onChange()
  }

  return { statusOf, forget, startUpdate, dismiss, compute }
}

export type CodexStatusService = ReturnType<typeof createCodexStatus>

export async function dirWritable(dir: string): Promise<boolean> {
  try {
    await fs.promises.access(dir, fs.constants.W_OK)
    return true
  } catch { return false }
}
