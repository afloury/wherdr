// Latest wherdr release on GitHub, checked at most once a day
// (public API without a token, nothing is sent). WHERDR_UPDATE_CHECK=off disables the call.
import pkg from '../../package.json'
import { compareVersions, installMode, oneTapMode, updateCommand, type UpdateInfo } from '../../shared/updates'

export const REPO = 'afloury/wherdr'
export const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=100`
const DAY_MS = 24 * 60 * 60 * 1000
// Failure (offline, API limit): new attempt in an hour.
const RETRY_MS = 60 * 60 * 1000

interface Release { version: string, url: string }
type Fetcher = (url: string) => Promise<{ ok: boolean, json: () => Promise<unknown>, text?: () => Promise<string> }>

export function createUpdateChecker(opts: {
  current: string
  env: NodeJS.ProcessEnv
  fetch: Fetcher
  now?: () => number
}) {
  const now = opts.now ?? Date.now
  let cached: Release | null = null
  let nextAt = 0
  let pending: Promise<void> | null = null

  async function refresh() {
    try {
      const res = await opts.fetch(RELEASES_URL)
      if (!res.ok) throw new Error('http')
      const releases = await res.json() as { tag_name?: unknown, html_url?: unknown, draft?: boolean, prerelease?: boolean }[]
      const body = releases.filter(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(String(r.tag_name)))
        .sort((a, b) => compareVersions(String(b.tag_name), String(a.tag_name)))[0]
      if (!body || typeof body.tag_name !== 'string') throw new Error('tag')
      cached = { version: body.tag_name.replace(/^v/, ''), url: typeof body.html_url === 'string' ? body.html_url : '' }
      const mode = installMode(opts.env.WHERDR_INSTALL)
      if (mode === 'npm' || mode === 'npm-global') {
        // Check the actual tarball, rather than trusting npm publish's exit code.
        const registry = (opts.env.npm_config_registry || 'https://registry.npmjs.org').replace(/\/$/, '')
        const available = await opts.fetch(`${registry}/wherdr/-/wherdr-${cached.version}.tgz`)
        if (!available.ok) { cached = null; nextAt = now() + RETRY_MS; return }
        if (mode === 'npm') {
          const latest = await opts.fetch(`${registry}/wherdr/latest`)
          if (!latest.ok || (await latest.json() as { version?: string }).version !== cached.version) {
            cached = null; nextAt = now() + RETRY_MS; return
          }
        }
      }
      if (mode === 'brew') {
        const formula = await opts.fetch('https://raw.githubusercontent.com/afloury/homebrew-tap/main/Formula/wherdr.rb')
        const text = formula.ok ? await formula.text?.() : ''
        if (!text?.includes(`/v${cached.version}/wherdr-${cached.version}.tgz"`)) {
          cached = null; nextAt = now() + RETRY_MS; return
        }
      }
      nextAt = now() + DAY_MS
    } catch { cached = null; nextAt = now() + RETRY_MS }
  }

  return async function check(): Promise<UpdateInfo> {
    const mode = installMode(opts.env.WHERDR_INSTALL)
    const base = { current: opts.current, mode, command: updateCommand(mode, REPO), oneTap: oneTapMode(mode) }
    if (String(opts.env.WHERDR_UPDATE_CHECK || '').toLowerCase() === 'off') return { ...base, latest: null, url: null, checked: false }
    if (now() >= nextAt) {
      pending ??= refresh().finally(() => { pending = null })
      await pending
    }
    const newer = cached && compareVersions(cached.version, opts.current) > 0
    return { ...base, latest: newer ? cached!.version : null, url: newer ? cached!.url || null : null, checked: !!cached }
  }
}

export const checkUpdate = createUpdateChecker({
  current: pkg.version,
  env: process.env,
  fetch: (url) => fetch(url, {
    method: url.endsWith('.tgz') ? 'HEAD' : 'GET',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'wherdr' },
    signal: AbortSignal.timeout(10_000),
  }),
})
