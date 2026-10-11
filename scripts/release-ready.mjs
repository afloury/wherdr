// Legacy 1.3.x updaters use releases/latest and download from npm. Keep that
// marker on the previous release until npm's package and latest tag both work.
import { execFileSync } from 'node:child_process'
export async function ready(version, request = fetch, repo = process.env.GITHUB_REPOSITORY) {
  if (!repo) throw new Error('GITHUB_REPOSITORY is required')
  const get = url => request(url, { signal: AbortSignal.timeout(15_000) })
  const metadata = await get('https://registry.npmjs.org/wherdr/latest')
  if (!metadata.ok || (await metadata.json()).version !== version) return false
  const tar = await request(`https://registry.npmjs.org/wherdr/-/wherdr-${version}.tgz`, { method: 'HEAD', signal: AbortSignal.timeout(15_000) })
  // Old Homebrew updaters must also find the requested keg version.
  const formula = await get(`https://raw.githubusercontent.com/${repo.split('/')[0]}/homebrew-tap/main/Formula/wherdr.rb`)
  return tar.ok && formula.ok && (await formula.text()).includes(`/v${version}/wherdr-${version}.tgz"`)
}
if (process.argv[1]?.endsWith('/release-ready.mjs')) {
  const repo = process.env.GITHUB_REPOSITORY
  const releases = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/releases?per_page=100`], { encoding: 'utf8' }))
  const versions = releases.filter(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name))
    .sort((a, b) => b.tag_name.slice(1).localeCompare(a.tag_name.slice(1), 'en', { numeric: true }))
  const tag = versions[0]?.tag_name
  if (tag && await ready(tag.slice(1))) {
    execFileSync('gh', ['release', 'edit', tag, '--repo', repo, '--latest'], { stdio: 'inherit' })
  } else console.log('Legacy update channel unchanged: waiting for npm and Homebrew.')
}
