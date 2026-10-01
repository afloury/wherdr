// Markdown of replies: marked for rendering, DOMPurify so that nothing
// an agent might have written gets executed. Cached by text (the
// conversation is re-read every 1.5 s).
import { marked } from 'marked'
import DOMPurify from 'dompurify'

let hooked = false
const cache = new Map<string, string>()

const escHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))

export function md(text: string): string {
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  if (!hooked) {
    hooked = true
    // Terminal-style framed code blocks: language + "Copy" button.
    marked.use({
      renderer: {
        code({ text, lang }) {
          const l = escHtml((lang || '').split(/\s/)[0] || '')
          return `<div class="code-block"><div class="code-head"><span>${l || 'code'}</span>`
            + `<button type="button" class="code-copy">${escHtml(t('Copier'))}</button></div>`
            + `<pre><code${l ? ` class="language-${l}"` : ''}>${escHtml(text)}</code></pre></div>`
        },
      },
    })
    DOMPurify.addHook('afterSanitizeAttributes', (n) => {
      if (n.tagName === 'A') {
        n.setAttribute('target', '_blank')
        n.setAttribute('rel', 'noopener noreferrer')
      }
    })
  }
  let html: string
  try { html = DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true, async: false }) as string) }
  catch { html = `<p>${escHtml(text)}</p>` }
  cache.set(text, html)
  if (cache.size > 5000) cache.delete(cache.keys().next().value!)
  return html
}
