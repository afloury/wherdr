// Avis de nouvelle version : comparaison de versions et commande de mise à jour
// selon le mode d'installation (partagé serveur / app, sans dépendance).

export type InstallMode = 'docker' | 'docker-build' | 'native'

export interface UpdateInfo {
  current: string
  // Dernière release publiée, si plus récente que `current` ; sinon null.
  latest: string | null
  url: string | null
  // La dernière release a pu être lue (contrôle actif, GitHub joignable).
  checked: boolean
  mode: InstallMode
  command: string
}

// « v1.2.3 », « 1.2.3-beta.1 » -> [1, 2, 3] ; null si illisible. Les préversions
// sont ignorées (jamais proposées : la release « latest » de GitHub n'en est pas une).
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v).trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// > 0 si a est plus récente que b ; 0 si égales ou illisibles.
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!
  return 0
}

export function installMode(env: string | undefined): InstallMode {
  return env === 'docker' || env === 'docker-build' ? env : 'native'
}

export function updateCommand(mode: InstallMode): string {
  if (mode === 'docker') return 'docker compose pull && docker compose up -d'
  if (mode === 'docker-build') return 'git pull && docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build'
  return 'git pull && npm ci && npm run build'
}
