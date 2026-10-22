// Validate reviewed stable-release notes without generating or changing their text.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function checkReleaseNotes(body, repo, tag) {
  const link = `https://github.com/${repo}/blob/${tag}/CHANGELOG.md`
  if (!body.includes(link)) throw new Error(`Release notes must link to ${link}`)
  const summary = body.slice(0, body.indexOf(link)).replace(/\[[^\]]*\]\($/, '')
  const sections = summary.replace(/\r\n/g, '\n').split(/^#{1,6}\s+(New|Improved|Fixed|Update)\s*$/m)
  const summaries = []
  for (let i = 2; i < sections.length; i += 2) {
    // Only prose inside a recognized section counts, excluding links, code and comments.
    const prose = sections[i].split(/^#{1,6}\s/m)[0]
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g, '')
    summaries.push(prose)
  }
  const prose = summaries.join('\n')
  const words = prose.match(/\b[a-zA-Z][a-zA-Z'-]*\b/g) || []
  const sentences = prose.match(/[.!?](?:\s|$)/g) || []
  if (words.length < 12 || sentences.length < 2) {
    throw new Error('Write at least two readable English sentences about the changes under New / Improved / Fixed / Update, followed by a CHANGELOG.md link. Link-only notes are not accepted.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkReleaseNotes(readFileSync(0, 'utf8'), process.env.GITHUB_REPOSITORY, process.env.GITHUB_REF_NAME)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
