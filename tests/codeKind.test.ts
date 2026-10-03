// Kind of an inline code span in a reply (terminal-style tints in the markdown).
import { describe, expect, it, vi } from 'vitest'
import { codeKind } from '../app/utils/codeKind'
import { pickInlineCodeStyle } from '../app/utils/inlineCodeStyle'
import { md } from '../app/utils/markdown'

vi.mock('dompurify', () => ({ default: { sanitize: (s: string) => s, addHook: () => {} } }))
;(globalThis as { t?: (s: string) => string }).t = s => s

describe('codeKind', () => {
  const cases: [string, ReturnType<typeof codeKind>][] = [
    ['app/assets/css/main.css', 'path'],
    ['~/projects/demo/README.md', 'path'],
    ['src/app.ts:42', 'path'],
    ['npx vitest run', 'cmd'],
    ['git rebase -i main', 'cmd'],
    ['$ make build', 'cmd'],
    ['/model', 'cmd'],
    ['foo --dry-run', 'cmd'],
    ['t-0188', 'id'],
    ['b1e9b83', 'id'],
    ['ABC-123', 'id'],
    ['2.84s', 'num'],
    ['3 min 43 s', 'num'],
    ['1257', 'num'],
    ['85%', 'num'],
    ['Ctrl+C', 'key'],
    ['⌘K', 'key'],
    ['shift-tab', 'key'],
    ['Esc', 'key'],
    ['↵', 'key'],
    ['exit 1', 'err'],
    ['FAIL', 'err'],
    ['ENOENT', 'err'],
    ['SIGKILL', 'err'],
    ['exit 0', 'ok'],
    ['pass', 'ok'],
  ]
  it.each(cases)('%s is %s', (code, kind) => expect(codeKind(code)).toBe(kind))

  it('leaves plain code without a kind', () => {
    for (const code of ['useState', 'console.log', 'delete', 'tab', 'Else', 'git', 'open', 'a && b', 'deadbeef', ''])
      expect(codeKind(code), code).toBeNull()
  })
})

describe('inline code markup', () => {
  it('tags each span with its kind and keeps paths clickable', () => {
    const html = md('Run `npm test` on `src/a.ts`, then `t-0001`, then `x`.')
    expect(html).toContain('<code data-k="cmd">npm test</code>')
    expect(html).toContain('<code class="md-path" data-k="path" role="button" tabindex="0">src/a.ts</code>')
    expect(html).toContain('<code data-k="id">t-0001</code>')
    expect(html).toContain('<code>x</code>')
  })
})

describe('pickInlineCodeStyle', () => {
  it('prefers the address, then the stored choice, then the current style', () => {
    expect(pickInlineCodeStyle('b', 'a')).toBe('b')
    expect(pickInlineCodeStyle(null, 'c')).toBe('c')
    expect(pickInlineCodeStyle('zz', 'nope')).toBe('0')
  })
})
