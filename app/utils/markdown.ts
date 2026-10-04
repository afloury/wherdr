// Markdown of replies: marked for rendering, DOMPurify so that nothing
// an agent might have written gets executed. Cached by text (the
// conversation is re-read every 1.5 s).
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { pathCandidate } from '../../shared/filePaths'
import { codeKind } from './codeKind'
import { blockCommand, inlineCommand } from './shellCommand'

let hooked = false
const cache = new Map<string, string>()

const escHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))

export function md(text: string): string {
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  if (!hooked) {
    hooked = true
    // Terminal-style framed code blocks: language + "Copy" button, and "Run"
    // on a shell command (shown only where the agent can run it, see
    // ChatView.vue). `data-cmd`: the command without its prompts, which Copy
    // and Run use (utils/shellCommand.ts).
    marked.use({
      renderer: {
        code({ text, lang }) {
          const l = escHtml((lang || '').split(/\s/)[0] || '')
          const cmd = blockCommand(text, lang)
          const run = cmd === null ? '' : `<button type="button" class="code-run">${escHtml(tl('Run', 'Lancer'))}</button>`
          return `<div class="code-block"${cmd === null ? '' : ` data-cmd="${escHtml(cmd)}"`}><div class="code-head"><span>${l || 'code'}</span>`
            + `<span class="code-tools">${run}<button type="button" class="code-copy">${escHtml(t('Copy'))}</button></span></div>`
            + `<pre><code${l ? ` class="language-${l}"` : ''}>${escHtml(text)}</code></pre></div>`
        },
        // Inline code that looks like a file path: a menu in the conversation
        // (Reveal in Finder, Open, Copy path; see ChatView.vue); like a
        // command: Copy and Run. Every span carries its kind
        // (utils/codeKind.ts) for the terminal-style tints.
        codespan({ text }) {
          const code = escHtml(text)
          if (pathCandidate(text)) return `<code class="md-path" data-k="path" role="button" tabindex="0">${code}</code>`
          const cmd = inlineCommand(text)
          if (cmd !== null) return `<code class="md-cmd" data-k="cmd" data-cmd="${escHtml(cmd)}" role="button" tabindex="0">${code}</code>`
          const kind = codeKind(text)
          return `<code${kind ? ` data-k="${kind}"` : ''}>${code}</code>`
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
