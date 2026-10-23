// Rolling releases describe the current Unreleased changes, not just build metadata.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { checkReleaseNotes } from './check-release-notes.mjs'

export function prereleaseSummary(changelog, repo, sha) {
  const unreleased = changelog.split(/^## (?:\[Unreleased\]|\d+\.\d+\.\d+ \(unreleased\))[^\n]*\n/m)[1]?.split(/^## /m)[0]
  const entries = unreleased?.match(/^- .*(?:\n(?!\s*$|[-#]).+)*/gm)?.slice(0, 3)
  if (!entries?.length) throw new Error('Add user-facing Unreleased entries to CHANGELOG.md before packaging a prerelease')
  const notes = `## Update\n\n${entries.join('\n\n')}\n\n[Full changelog](https://github.com/${repo}/blob/${sha}/CHANGELOG.md)\n`
  checkReleaseNotes(notes, repo, sha)
  return notes
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).repository.url
    .replace(/^git\+https:\/\/github.com\//, '').replace(/\.git$/, '')
  console.log(prereleaseSummary(readFileSync('CHANGELOG.md', 'utf8'), process.env.GH_REPO || process.env.GITHUB_REPOSITORY || repo, process.argv[2]))
}
