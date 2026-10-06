// Quoted replies, "native" mode (utils/quoteTokens.ts): the field stays the
// native textarea, with the same "> quote" / answer text as the plain mode
// (utils/questionReply.ts), so sending, Enter, "/", image paste, dictation and
// autocorrect do not change; only its drawing does. A mirror behind the
// textarea draws the same text with the same metrics (font, size, padding,
// wrapping, scroll), each "> " line as a compact token; the textarea's own
// text is transparent, its caret and selection stay visible. Nothing in the
// mirror may change a line's width or height: same font size, no vertical
// margin or padding, the "> " kept (hidden, "↳" drawn over it), the band
// widened into the padding by margin = -padding.

export interface MirrorLine { quote: boolean, prefix: string, text: string, first: boolean, last: boolean }

// The textarea's lines, as drawn: a "> " line keeps its prefix apart (same
// characters, hidden), `first`/`last` mark the ends of a run of quote lines.
export function mirrorLines(value: string): MirrorLine[] {
  const lines = value.split('\n').map((line) => {
    const m = /^>\s?/.exec(line)
    return { quote: Boolean(m), prefix: m ? m[0] : '', text: m ? line.slice(m[0].length) : line, first: false, last: false }
  })
  lines.forEach((l, i) => {
    l.first = l.quote && !lines[i - 1]?.quote
    l.last = l.quote && !lines[i + 1]?.quote
  })
  return lines
}

// Styles that decide where text wraps and how it is drawn.
const COPIED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'fontKerning', 'fontFeatureSettings',
  'fontVariationSettings', 'fontVariantLigatures', 'fontOpticalSizing', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform',
  'textIndent', 'textRendering', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak', 'hyphens', 'direction',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'boxSizing',
] as const

// Draws `ta`'s quote lines as tokens until destroyed. Call render() when the
// value is set from script (no input event).
export function attachQuoteMirror(ta: HTMLTextAreaElement) {
  const host = ta.parentElement!
  const box = document.createElement('div')
  box.className = 'qm-mirror'
  box.setAttribute('aria-hidden', 'true')
  const inner = document.createElement('div')
  box.append(inner)
  host.insertBefore(box, ta)
  host.classList.add('qm-host')
  ta.classList.add('qm-on')
  let alive = true

  function scroll() {
    inner.style.transform = `translateY(${-ta.scrollTop}px)`
  }
  function layout() {
    if (!alive) return
    const cs = getComputedStyle(ta)
    for (const k of COPIED) box.style[k] = cs[k]
    box.style.borderStyle = 'solid'
    box.style.borderColor = 'transparent'
    // A classic scrollbar narrows the textarea's text: same width for the mirror.
    const bars = ta.offsetWidth - ta.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
    box.style.paddingRight = `${parseFloat(cs.paddingRight) + Math.max(0, bars)}px`
    box.style.top = `${ta.offsetTop}px`
    box.style.left = `${ta.offsetLeft}px`
    box.style.width = `${ta.offsetWidth}px`
    box.style.height = `${ta.offsetHeight}px`
    box.style.setProperty('--qm-pl', cs.paddingLeft)
    box.style.setProperty('--qm-pr', box.style.paddingRight)
    scroll()
  }
  function render() {
    inner.textContent = ''
    for (const l of mirrorLines(ta.value)) {
      const row = document.createElement('div')
      if (l.quote) {
        row.className = `qm-q${l.first ? ' first' : ''}${l.last ? ' last' : ''}`
        const p = document.createElement('span')
        p.className = 'qm-p'
        p.textContent = l.prefix
        row.append(p)
      }
      // An empty line still takes one line (zero-width space).
      row.append(l.text || '\u200B')
      inner.append(row)
    }
    layout()
  }
  ta.addEventListener('input', render)
  ta.addEventListener('scroll', scroll, { passive: true })
  const ro = new ResizeObserver(layout)
  ro.observe(ta)
  // Web fonts arriving later change the metrics.
  void document.fonts?.ready.then(layout)
  render()

  return {
    render,
    destroy() {
      alive = false
      ro.disconnect()
      ta.removeEventListener('input', render)
      ta.removeEventListener('scroll', scroll)
      ta.classList.remove('qm-on')
      host.classList.remove('qm-host')
      box.remove()
    },
  }
}
