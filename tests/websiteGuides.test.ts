import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AGENT_PROMPT, REPO } from '../website/app/utils/site'

// website/public/agent.md guides coding agents through an install: every
// command, port and variable it cites must be one the README or the installer
// script really uses, so the guide cannot drift from them.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const guide = read('../website/public/agent.md')
// Shell line continuations joined, as in the guide's snippets below.
const sources = (read('../README.md') + read('../website/public/install')).replace(/\\\n\s*/g, '')
const llms = read('../website/public/llms.txt')

// Checks an agent runs to verify a step: not in the README, harmless, read-only.
const CHECKS = ['curl -fsS http://127.0.0.1:7683', 'docker compose ps', 'tailscale serve status', 'git --version', 'node --version']
// Placeholders and file paths the guide names, not commands.
const PLAIN = /^(~\/[\w./-]+|\.env|TASKS\.md|docker|herdr-projects (skill|doctor)|https:\/\/<machine>\.<tailnet>\.ts\.net:7683\/)$/

const snippets = [
  ...[...guide.matchAll(/```sh\n([\s\S]*?)```/g)].flatMap(([, block]) =>
    block!.replace(/\\\n\s*/g, '').split('\n').map(l => l.replace(/\s+#.*$/, '').trim()).filter(Boolean)),
  ...[...guide.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map(([, s]) => s!),
]

describe('agent.md', () => {
  it.each(snippets.filter(s => !CHECKS.includes(s) && !PLAIN.test(s)))('`%s` is in the README or the installer', (snippet) => {
    // The guide fills one placeholder; the README writes a sample address.
    const s = snippet.replace('https://<machine>.<tailnet>.ts.net:7683/', 'https://server.example.ts.net:7683/')
    expect(sources).toContain(s)
  })

  it.each([...new Set(guide.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g))])('variable %s exists', (name) => {
    expect(sources).toMatch(new RegExp(`\\b${name}\\b`))
  })

  it.each([...new Set(guide.match(/(?<=[:= ])\d{4,5}\b/g))])('port %s exists', (port) => {
    expect(sources).toMatch(new RegExp(`(?:127\\.0\\.0\\.1|localhost|PORT)[:=]${port}\\b`))
  })

  it('cites the Herdr version the installer requires', () => {
    const min = read('../website/public/install').match(/version_lt "\$\{HERDR_VERSION:-0\}" "([\d.]+)"/)![1]
    expect(guide).toContain(`Herdr ≥ ${min}`)
  })

  it('README anchors it links exist', () => {
    const anchors = new Set(read('../README.md').match(/^#+ .+$/gm)!
      .map(h => h.replace(/^#+ /, '').toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s/g, '-')))
    for (const [, a] of guide.matchAll(new RegExp(`${REPO.replace(/[./]/g, '\\$&')}#([\\w-]+)`, 'g'))) {
      if (a !== 'readme') expect(anchors).toContain(a)
    }
  })

  it('the install tab prompt points to it', () => {
    expect(AGENT_PROMPT).toContain('https://wherdr.dev/agent.md')
  })
})

describe('llms.txt', () => {
  const links = [...llms.matchAll(/\]\((https?:[^)]+)\)/g)].map(([, url]) => url!)

  it('starts with the llmstxt.org title and summary', () => {
    expect(llms).toMatch(/^# wherdr\n\n> \S/)
  })

  it.each(links.filter(u => u.startsWith('https://wherdr.dev/')))('%s is a file of website/public', (url) => {
    expect(existsSync(new URL(`../website/public/${url.slice('https://wherdr.dev/'.length)}`, import.meta.url))).toBe(true)
  })

  it.each(links.filter(u => u.includes('raw.githubusercontent.com')))('%s is a file of the repository', (url) => {
    const [, repo, path] = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/main\/(.+)$/)!
    expect(`https://github.com/${repo}`).toBe(REPO)
    expect(existsSync(new URL(`../${path}`, import.meta.url))).toBe(true)
  })
})
