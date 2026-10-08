// New version notice: version comparison and update command
// depending on the installation mode (shared by server / app, no dependency).

// npm: started from the published package (npx / bunx / pnpm dlx wherdr, bin/wherdr.mjs).
// brew: the same package, installed by the Homebrew formula (the project's tap).
export type InstallMode = 'docker' | 'docker-build' | 'native' | 'npm' | 'brew'

export interface UpdateInfo {
  current: string
  // Latest published release, if newer than `current`; otherwise null.
  latest: string | null
  url: string | null
  // The latest release could be read (check enabled, GitHub reachable).
  checked: boolean
  mode: InstallMode
  command: string
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

export function installMode(env: string | undefined): InstallMode {
  return env === 'docker' || env === 'docker-build' || env === 'npm' || env === 'brew' ? env : 'native'
}

export function updateCommand(mode: InstallMode): string {
  if (mode === 'docker') return 'docker compose pull && docker compose up -d'
  if (mode === 'docker-build') return 'git pull && docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build'
  if (mode === 'npm') return 'npx wherdr@latest'
  if (mode === 'brew') return 'brew upgrade wherdr'
  return 'git pull && npm ci && npm run build'
}
