import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_MAX, highlightCode } from '../app/utils/codeHighlight'

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&')

describe('code block colours', () => {
  it('marks keywords, strings, numbers and comments, keeping the text intact', () => {
    const src = 'const n = 42 // answer\nreturn "a<b>"'
    const html = highlightCode(src, 'ts')
    expect(html).toContain('<span class="hl-k">const</span>')
    expect(html).toContain('<span class="hl-n">42</span>')
    expect(html).toContain('<span class="hl-c">// answer</span>')
    expect(html).toContain('<span class="hl-s">&quot;a&lt;b&gt;&quot;</span>')
    expect(text(html)).toBe(src)
  })

  it('knows shell, SQL and HTML comments', () => {
    expect(highlightCode('echo hi # note', 'bash')).toContain('<span class="hl-c"># note</span>')
    expect(highlightCode('SELECT 1 -- one', 'sql')).toContain('<span class="hl-k">SELECT</span>')
    expect(highlightCode('<p class="x">hi</p>', 'html')).toContain('<span class="hl-t">&lt;p</span>')
  })

  it('only escapes an unknown language or a very large block', () => {
    expect(highlightCode('if <x>', 'brainfuck')).toBe('if &lt;x&gt;')
    expect(highlightCode('', 'ts')).toBe('')
    const big = 'const a = 1\n'.repeat(Math.ceil(HIGHLIGHT_MAX / 12) + 1)
    expect(highlightCode(big, 'ts')).not.toContain('<span')
  })
})
