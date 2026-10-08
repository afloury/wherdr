// One-tap update (Update button): checks the request, writes the plan and runs
// bin/lib/updater.mjs detached from this server, which it then replaces. The
// updater reports in <wherdr dir>/update.json (read here for the app) and
// update.log.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pkg from '../../package.json'
import { installMode, oneTapMode, updateRunning, type InstallMode, type UpdateJob } from '../../shared/updates'
import { log } from './env'
import { HerdrError } from './herdr'
import { checkUpdate } from './updates'

export function wherdrDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = os.homedir()
  const dir = env.WHERDR_DIR || path.join(home, 'wherdr')
  return path.resolve(dir === '~' ? home : dir.startsWith('~/') ? path.join(home, dir.slice(2)) : dir)
}

export function readJob(dir: string): UpdateJob | null {
  try {
    const job = JSON.parse(fs.readFileSync(path.join(dir, 'update.json'), 'utf8'))
    return job && typeof job.state === 'string' ? job as UpdateJob : null
  } catch { return null }
}

export interface UpdatePlan {
  kind: InstallMode
  from: string
  to: string
  root: string
  dir: string
  runtime: string
  serverPid: number
  port: string
  host: string
  registry: string
}

// Why an update cannot start now (HerdrError code + English message), or the
// plan. The install mode decides: the Docker image sets WHERDR_INSTALL=docker.
export function buildPlan(o: {
  mode: InstallMode, current: string, latest: string | null, to: unknown,
  job: UpdateJob | null, now: number, root: string, dir: string, runtime: string, pid: number, env: NodeJS.ProcessEnv,
}): UpdatePlan {
  if (!oneTapMode(o.mode)) throw new HerdrError('update_manual', 'This installation cannot update itself: run the update command')
  if (updateRunning(o.job, o.now)) throw new HerdrError('update_running', 'An update is already in progress')
  // Only the release the server itself found: never a version picked by the client.
  if (!o.latest || o.to !== o.latest) throw new HerdrError('update_version', 'No newer version to install')
  return {
    kind: o.mode,
    from: o.current,
    to: o.latest,
    root: o.root,
    dir: o.dir,
    runtime: o.runtime,
    serverPid: o.pid,
    port: String(o.env.NITRO_PORT || o.env.PORT || 3000),
    host: String(o.env.NITRO_HOST || o.env.HOST || '127.0.0.1'),
    registry: o.env.npm_config_registry || 'https://registry.npmjs.org',
  }
}

// Package folder of the running server (bin/ and .output/): set by the wherdr
// command (bin/lib/core.mjs), which may run the server in its own process.
const packageRoot = () => process.env.WHERDR_ROOT || path.resolve(path.dirname(process.argv[1] || ''), '..', '..')

export async function startUpdate(to: unknown): Promise<UpdateJob> {
  const dir = wherdrDir()
  const info = await checkUpdate()
  const root = packageRoot()
  const plan = buildPlan({
    mode: installMode(process.env.WHERDR_INSTALL), current: pkg.version, latest: info.latest, to,
    job: readJob(dir), now: Date.now(), root, dir, runtime: process.execPath, pid: process.pid, env: process.env,
  })
  const source = path.join(root, 'bin', 'lib', 'updater.mjs')
  if (!fs.existsSync(source)) throw new HerdrError('update_manual', 'The updater is missing from this installation: run the update command')
  // Out of the package: npm and Homebrew replace that folder while it runs.
  const work = path.join(dir, 'update')
  fs.mkdirSync(work, { recursive: true })
  const updater = path.join(work, 'updater.mjs')
  const planFile = path.join(work, 'plan.json')
  fs.copyFileSync(source, updater)
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`)
  const now = Date.now()
  const job: UpdateJob = { state: 'installing', from: plan.from, to: plan.to, mode: plan.kind, startedAt: now, updatedAt: now }
  fs.writeFileSync(path.join(dir, 'update.json'), `${JSON.stringify(job)}\n`)
  const out = fs.openSync(path.join(dir, 'update.log'), 'a')
  // Under systemd (login service, brew services on Linux), restarting the unit
  // kills its whole cgroup: the updater runs in a scope of its own.
  const scoped = !!process.env.INVOCATION_ID && spawnSync('systemd-run', ['--version'], { stdio: 'ignore' }).status === 0
  const [cmd, args] = scoped
    ? ['systemd-run', ['--user', '--scope', '--collect', '--quiet', process.execPath, updater, planFile]]
    : [process.execPath, [updater, planFile]]
  const child = spawn(cmd, args, { cwd: dir, env: process.env, detached: true, stdio: ['ignore', out, out] })
  fs.closeSync(out)
  child.on('error', e => log(`update: ${e.message}`))
  child.unref()
  log(`update: ${plan.from} → ${plan.to} (${plan.kind}) started, pid ${child.pid}`)
  return job
}
