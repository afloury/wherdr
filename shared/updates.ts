// New version notice: version comparison, update command depending on the
// installation mode, and the state of a one-tap update (shared by server / app,
// no dependency).

// npm: started from a temporary package folder (npx / bunx / pnpm dlx wherdr).
// npm-global: the package installed by `npm i -g wherdr` (<prefix>/lib/node_modules/wherdr).
// brew: the same package, installed by the Homebrew formula (the project's tap).
// plugin: the copy the Herdr plugin runs in native mode (~/wherdr/app).
export type InstallMode = 'native' | 'npm' | 'npm-global' | 'brew' | 'plugin'

// One-tap update (bin/lib/updater.mjs): written by the updater to
// ~/wherdr/update.json, read back by the server for the app.
export type UpdateState = 'installing' | 'restarting' | 'checking' | 'rolling-back' | 'done' | 'rolled-back' | 'failed'
export interface UpdateJob {
  state: UpdateState
  from: string
  to: string
  mode: InstallMode
  // Error of a failed update, in English (also in ~/wherdr/update.log).
  message?: string
  startedAt: number
  updatedAt: number
}

export interface UpdateInfo {
  current: string
  // Latest published release, if newer than `current`; otherwise null.
  latest: string | null
  url: string | null
  // The latest release could be read (check enabled, GitHub reachable).
  checked: boolean
  mode: InstallMode
  command: string
  // wherdr can update itself from the app in this mode (button Update).
  oneTap: boolean
  // Stable releases newer than current, among the latest 100 API entries.
  // Optional so cached state and older API responses remain usable.
  behind?: number
  missed?: string[] // newest first, at most five versions (including latest)
  behindAtLeast?: boolean // the API page was full: the count is a lower bound
  // A stable release of a newer major (wherdr 3): never installed over this
  // one, announced by a card instead (see MajorReleaseCard).
  nextMajor?: MajorMove | null
}

// "v1.2.3", "1.2.3-beta.1" -> [1, 2, 3]; null if unreadable. Pre-releases
// are ignored (never offered: GitHub's "latest" release is never one).
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v).trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// > 0 if a is newer than b; 0 if equal or unreadable.
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!
  return 0
}

export function majorOf(v: string): number | null {
  return parseVersion(v)?.[0] ?? null
}

// Release branch of a major: `2.x` (plugin ref, curl installer, native checkout).
export const releaseBranch = (current: string) => `${majorOf(current) ?? 0}.x`

// v3 installs beside v2 (never over it): its release notes, migration guide
// and the installer command (a dry run until `--yes`).
export interface MajorMove { version: string, url: string, guide: string, command: string }
export function majorMove(repo: string, version: string, url?: string): MajorMove {
  const major = majorOf(version)
  return {
    version,
    url: url || `https://github.com/${repo}/releases/tag/v${version}`,
    guide: `https://github.com/${repo}/blob/v${major}/docs/migrate-from-v2.md`,
    command: `git clone -b v${major} https://github.com/${repo}.git /tmp/wherdr-setup && sh /tmp/wherdr-setup/scripts/install-v${major}-beside-v2.sh`,
  }
}

const MODES: InstallMode[] = ['npm', 'npm-global', 'brew', 'plugin']
export function installMode(env: string | undefined): InstallMode {
  return MODES.find(m => m === env) ?? 'native'
}

// `repo`: owner/name of the GitHub repository (the Herdr plugin installs from it).
// `branch`: release branch of the running major (`2.x`), never `main`, which
// holds the next major.
export function updateCommand(mode: InstallMode, repo: string, branch: string): string {
  if (mode === 'npm') return 'npx wherdr@latest'
  if (mode === 'npm-global') return 'npm install -g wherdr@latest && wherdr restart'
  if (mode === 'brew') return 'brew upgrade wherdr && brew services restart wherdr'
  if (mode === 'plugin') return `herdr plugin install ${repo} --ref ${branch} --yes`
  return `git checkout ${branch} && git pull && npm ci && npm run build`
}

// Modes the server can update and restart by itself;
// not npx (a temporary folder: running `npx wherdr@latest` again is the
// update); not a checkout (local changes, build of several minutes).
export function oneTapMode(mode: InstallMode): boolean {
  return mode === 'plugin' || mode === 'npm-global' || mode === 'brew'
}

// An update still in progress (not finished, and not abandoned: an updater
// killed half-way leaves a state that stops counting after 10 minutes).
export function updateRunning(job: UpdateJob | null, now: number): boolean {
  return !!job && !['done', 'rolled-back', 'failed'].includes(job.state) && now - job.updatedAt < 10 * 60_000
}
