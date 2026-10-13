// Markdown of replies: marked for rendering, DOMPurify so that nothing
// an agent might have written gets executed. Cached by text (the
// conversation is re-read every 1.5 s), within a budget (see MD_CACHE_CHARS).
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { pathCandidate } from '../../shared/filePaths'
import { codeKind } from './codeKind'
import { createRenderCache, createSupersedeTracker } from './renderCache'
import { blockCommand, inlineCommand } from './shellCommand'

let hooked = false
// Budget of the cache, in characters of text + HTML: about 4 MB of strings
// (twice that if a text is not Latin-1), small for a phone tab yet above what
// one 2 MiB page of transcript renders to, so a long conversation on screen
// is not parsed again at every re-read.
export const MD_CACHE_ENTRIES = 5000
export const MD_CACHE_CHARS = 4_000_000
const cache = createRenderCache<string>(MD_CACHE_ENTRIES, MD_CACHE_CHARS)
export const mdCacheStats = () => cache.stats()
// A reply still being written: each longer version replaces the previous one
// instead of piling up. What was derived from the dropped HTML is told to go
// too (utils/questionReply.ts, wired in ChatView.vue).
const superseded = createSupersedeTracker()
const dropListeners = new Set<(html: string) => void>()
export function onMdDropped(fn: (html: string) => void) { dropListeners.add(fn) }

// `plain`: Markdown from a file kept on disk (a project's memory), shown
// outside a conversation. Its raw HTML must not restyle the app or draw
// controls over it: no `<style>`, no `style` attribute, no form or field. A
// task list's own checkbox (`- [ ]`, disabled) is kept.
export interface MdOptions { plain?: boolean }
const PLAIN = { FORBID_TAGS: ['style', 'form', 'textarea', 'select', 'option', 'optgroup', 'fieldset', 'legend', 'label', 'datalist', 'output', 'dialog'], FORBID_ATTR: ['style'] }
let plainNow = false

const escHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))

export function md(text: string, options: MdOptions = {}): string {
  // The two modes never share a cached result.
  const key = options.plain ? `\0plain\0${text}` : text
  const hit = cache.get(key)
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
    DOMPurify.addHook('uponSanitizeElement', (n, data) => {
      if (!plainNow || data.tagName !== 'input') return
      const el = n as Element
      if (!(el.getAttribute('type') === 'checkbox' && el.hasAttribute('disabled'))) el.parentNode?.removeChild(el)
    })
    DOMPurify.addHook('afterSanitizeAttributes', (n) => {
      if (n.tagName === 'A') {
        n.setAttribute('target', '_blank')
        n.setAttribute('rel', 'noopener noreferrer')
      }
    })
  }
  let html: string
  plainNow = Boolean(options.plain)
  try {
    const parsed = marked.parse(text, { breaks: true, gfm: true, async: false }) as string
    html = plainNow ? DOMPurify.sanitize(parsed, PLAIN) : DOMPurify.sanitize(parsed)
  } catch { html = `<p>${escHtml(text)}</p>` }
  finally { plainNow = false }
  for (const old of superseded(key)) {
    const gone = cache.delete(old)
    if (gone !== undefined && gone !== html) for (const fn of dropListeners) fn(gone)
  }
  cache.set(key, html, key.length + html.length)
  return html
}
