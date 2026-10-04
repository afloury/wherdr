// Commands proposed in an agent's reply: what Copy and Run take from a code
// block or an inline span, and how each agent runs it.
import { describe, expect, it, vi } from 'vitest'
import { blockCommand, inlineCommand, runMessage } from '../app/utils/shellCommand'
import { md } from '../app/utils/markdown'

vi.mock('dompurify', () => ({ default: { sanitize: (s: string) => s, addHook: () => {} } }))
Object.assign(globalThis, { t: (s: string) => s, tl: (en: string) => en })

describe('blockCommand', () => {
  it('drops Claude Code’s "!" and the "$" prompt', () => {
    expect(blockCommand('! gh pr merge 1 --repo owner/app --merge\n', '')).toBe('gh pr merge 1 --repo owner/app --merge')
    expect(blockCommand('$ npm test', 'bash')).toBe('npm test')
    expect(blockCommand('!ls -la', 'sh')).toBe('ls -la')
  })

  it('keeps a shell script as written, several lines included', () => {
    expect(blockCommand('cd app\nnpm ci && npm run build\n', 'bash')).toBe('cd app\nnpm ci && npm run build')
    expect(blockCommand('echo "$HOME"\n[ -n "$X" ] && ! false', 'zsh')).toBe('echo "$HOME"\n[ -n "$X" ] && ! false')
  })

  it('console transcript: prompted lines and their continuations, output left out', () => {
    const code = '$ docker run --rm \\\n    -v "$PWD":/app node:22\nhello from the container\n$ echo done\ndone'
    expect(blockCommand(code, 'console')).toBe('docker run --rm \\\n    -v "$PWD":/app node:22\necho done')
  })

  it('no language: only when every line reads as a command', () => {
    expect(blockCommand('git fetch origin\ngit rebase origin/main', '')).toBe('git fetch origin\ngit rebase origin/main')
    expect(blockCommand('# update\nnpm ci \\\n  --no-audit', null)).toBe('# update\nnpm ci \\\n  --no-audit')
    expect(blockCommand('const a = 1\nconsole.log(a)', '')).toBeNull()
    expect(blockCommand('git fetch origin\nthen look at the log', '')).toBeNull()
    expect(blockCommand('/compact', '')).toBeNull()
  })

  it('other languages and empty blocks are not commands', () => {
    expect(blockCommand('npm test', 'ts')).toBeNull()
    expect(blockCommand('$ npm test', 'text')).toBeNull()
    expect(blockCommand('\n  \n', 'bash')).toBeNull()
  })
})

describe('inlineCommand', () => {
  it('reads a prompted span as a command, prompt removed', () => {
    expect(inlineCommand('! gh pr merge 5 --repo owner/app --merge')).toBe('gh pr merge 5 --repo owner/app --merge')
    expect(inlineCommand('$ make build')).toBe('make build')
    expect(inlineCommand('!git status')).toBe('git status')
  })

  it('takes a span that reads as a command as it is', () => {
    expect(inlineCommand('npx vitest run')).toBe('npx vitest run')
    expect(inlineCommand('foo --dry-run')).toBe('foo --dry-run')
  })

  it('leaves slash commands, paths, plain code and "!" operators alone', () => {
    for (const code of ['/compact', '/model opus', 'src/app.ts', 'useState', '!important', '!==', '$HOME', 'git', ''])
      expect(inlineCommand(code), code).toBeNull()
  })
})

describe('runMessage', () => {
  it('uses the "!" shell mode of Claude Code, Codex and omp', () => {
    for (const agent of ['claude', 'codex', 'omp']) expect(runMessage(agent, 'echo hello')).toBe('! echo hello')
  })

  it('no shell mode, no run', () => {
    expect(runMessage('gemini', 'echo hello')).toBeNull()
    expect(runMessage(null, 'echo hello')).toBeNull()
    expect(runMessage('claude', '  ')).toBeNull()
  })
})

describe('markup', () => {
  it('shell block: Run beside Copy, and the command without prompts for both', () => {
    const html = md('```bash\n$ npm test\n```')
    expect(html).toContain('data-cmd="npm test"')
    expect(html).toContain('class="code-run"')
  })

  it('other code blocks: Copy only', () => {
    const html = md('```ts\nconst a = 1\n```')
    expect(html).not.toContain('data-cmd')
    expect(html).not.toContain('code-run')
    expect(html).toContain('class="code-copy"')
  })

  it('inline command: tappable, command escaped in its attribute', () => {
    const html = md('Merge it: `! gh pr merge 5 --body "ok"`.')
    expect(html).toContain('<code class="md-cmd" data-k="cmd" data-cmd="gh pr merge 5 --body &quot;ok&quot;" role="button" tabindex="0">')
  })
})
