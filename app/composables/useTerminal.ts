// Terminal of a pane: xterm.js connected to /ws/term (Herdr's ANSI frames).
// Herdr keeps the history: no local scrollback, scrolling is
// requested from the server (terminal.scroll).
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { terminalPixelWidth } from '~/utils/terminalSize'
import { bindTerminalSelection } from '~/utils/terminalSelection'
import { bindTerminalLinks, type TerminalLinks } from '~/utils/terminalLinks'
import { bindShiftEnter } from '~/utils/terminalKeys'
import { terminalClosedText, terminalUnavailableText } from '~/utils/terminalClosed'
import { TERM_FONT, onFontsLoaded } from '~/utils/terminalFont'

export interface Banner { text: string, btn: string, fn: () => void }

export function createTerminal(paneId: string, opts: { setBanner: (b: Banner | null) => void, hasBanner: () => boolean }) {
  let term: Terminal | null = null
  let fit: FitAddon | null = null
  let webgl: WebglAddon | null = null
  let el: HTMLElement | null = null
  let tws: WebSocket | null = null
  let twsRetry = 0
  let twsTimer: ReturnType<typeof setTimeout> | undefined
  let twsIntent = false
  let lastSize = { cols: 0, rows: 0 }
  let disposed = false
  const loading = ref(false)
  const kbdOn = ref(false)
  const selectionHint = useTerminalSelectionHint()
  let unbindSelection: (() => void) | null = null
  let unbindFonts: (() => void) | null = null
  let links: TerminalLinks | null = null

  const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

  function mount(host: HTMLElement) {
    el = host
    disposed = false
    twsRetry = 0
    term = new Terminal({
      fontFamily: TERM_FONT,
      fontSize: fontSize.value,
      // Line height 1: block characters (Claude Code logo) and
      // box-drawing lines must touch from one line to the next.
      lineHeight: 1,
      scrollback: 0, // Herdr keeps the history; scrolling happens on the server
      cursorBlink: false,
      allowProposedApi: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      // Palette of the app theme (Settings → Theme), updated live.
      theme: terminalTheme.value,
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    // Selection of the visible text, copied on release or with ⌘C.
    unbindSelection = bindTerminalSelection(term, () => toast(t('Copied')))
    // OSC 8 hyperlinks and http(s) URLs, opened in a new tab.
    links = bindTerminalLinks(term, t)
    // The device's choice may change while the terminal stays mounted.
    setRenderer(terminalRenderer.value)
    // JetBrains Mono (bundled): once loaded, xterm re-measures its cells.
    const t0 = term
    Promise.all([
      document.fonts?.load(`${fontSize.value}px "JetBrains Mono Variable"`),
      document.fonts?.load(`${fontSize.value}px "Wherdr Symbols"`, '─▀█⎿⏵⏺✻✳'),
    ]).then(() => {
      if (disposed || term !== t0) return
      t0.options.fontFamily = TERM_FONT
      fitNow(true)
      t0.refresh(0, t0.rows - 1)
    }).catch(() => {})
    // Nerd Font icons load on first use (unicode-range): the WebGL atlas
    // may already hold empty boxes for them, redraw once the face arrives.
    unbindFonts = onFontsLoaded(() => {
      if (disposed || term !== t0) return
      t0.clearTextureAtlas()
      t0.refresh(0, t0.rows - 1)
    })
    const ta = term.textarea
    if (ta) {
      ta.setAttribute('autocorrect', 'off')
      ta.setAttribute('autocapitalize', 'off')
      ta.setAttribute('spellcheck', 'false')
      ta.addEventListener('blur', () => { kbdOn.value = false })
      ta.addEventListener('focus', () => { kbdOn.value = true })
    }
    // Wheel: xterm does nothing with it (it would send ↑/↓ to the agent, see
    // utils/terminalWheel.ts); TerminalView converts it to terminal.scroll.
    term.attachCustomWheelEventHandler(() => false)
    bindShiftEnter(term, key => sendKeys([key]))
    term.onData(d => sendTerm({ type: 'terminal.input', text: d }))
    term.onBinary((d) => {
      const bytes = Uint8Array.from(d, c => c.charCodeAt(0) & 0xff)
      sendTerm({ type: 'terminal.input', bytes: bytesToB64(bytes) })
    })
  }

  function sendTerm(obj: unknown): boolean {
    if (tws && tws.readyState === 1) {
      tws.send(JSON.stringify(obj))
      return true
    }
    return false
  }

  // Logical keys (esc, up, shift+tab…), encoded by Herdr according to the terminal
  // mode: through the WebSocket if it is open, otherwise through the API.
  async function sendKeys(keys: string[]) {
    if (sendTerm({ type: 'keys', keys })) return
    try {
      await api('/api/input', { pane_id: paneId, keys })
      haptic()
    } catch (err) { toast((err as Error).message, true) }
  }

  function fitNow(send: boolean) {
    if (!term || !fit || !el || !el.parentElement) return
    // FitAddon measures the parent of .xterm (#term), not .xterm itself.
    // On the phone, the inset of #term already defines its width.
    const desktop = matchMedia('(min-width: 900px)').matches
    el.style.width = desktop ? `${terminalPixelWidth(el.parentElement.clientWidth, contentWidth.value)}px` : ''
    const p = fit.proposeDimensions()
    if (!p || !p.cols || !p.rows) return
    const d = { cols: p.cols, rows: p.rows }
    if (d.cols !== term.cols || d.rows !== term.rows) term.resize(d.cols, d.rows)
    if (send && (d.cols !== lastSize.cols || d.rows !== lastSize.rows)) {
      if (sendTerm({ type: 'terminal.resize', cols: d.cols, rows: d.rows })) lastSize = { cols: d.cols, rows: d.rows }
    }
  }

  // Theme change while the terminal is shown.
  watch(terminalTheme, (th) => { if (term) term.options.theme = th })
  // The preference changes the width in pixels, then FitAddon re-measures.
  watch(contentWidth, () => nextTick(() => fitNow(true)))

  function setRenderer(renderer: 'webgl' | 'html') {
    if (!term) return
    if (webgl) {
      const old = webgl
      webgl = null
      old.dispose()
    }
    if (renderer === 'webgl') {
      let addon: WebglAddon | null = null
      try {
        addon = new WebglAddon()
        const next = addon
        addon.onContextLoss(() => {
          if (webgl !== next) return
          webgl = null
          next.dispose()
          reportTerminalRenderer('html-fallback')
          fitNow(true)
        })
        term.loadAddon(addon)
        webgl = addon
        reportTerminalRenderer('webgl')
      } catch {
        try { addon?.dispose() } catch { /* addon partially activated */ }
        // WebGL unavailable: xterm keeps the HTML renderer.
        reportTerminalRenderer('html-fallback')
      }
    } else {
      reportTerminalRenderer('html')
    }
    // The cell size may change with the renderer. The wheel and
    // the pane size stay handled by fitNow / TerminalView.
    fitNow(true)
  }
  watch(terminalRenderer, setRenderer)

  function setFontSize(n: number) {
    if (!term) return
    term.options.fontSize = n
    fitNow(true)
  }

  function connect(takeover: boolean) {
    if (disposed || !term) return
    clearTimeout(twsTimer)
    if (tws) {
      tws.onclose = null
      try { tws.close(1000) }
      catch { /* already closed */ }
    }
    fitNow(false)
    const q = new URLSearchParams({ pane: paneId, cols: String(term.cols), rows: String(term.rows) })
    if (takeover) q.set('takeover', '1')
    loading.value = true
    twsIntent = true
    let closedReason: string | null = null
    let gotFrame = false
    let lastErr = ''
    const ws = new WebSocket(`${wsBase()}/ws/term?${q}`)
    tws = ws
    ws.onopen = () => {
      if (term) lastSize = { cols: term.cols, rows: term.rows }
      ws.send(JSON.stringify({ type: 'visibility', visible: !document.hidden }))
    }
    ws.onmessage = (e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let m: any
      try { m = JSON.parse(e.data) }
      catch { return }
      if (m.type === 'terminal.frame') {
        if (!gotFrame) {
          gotFrame = true
          twsRetry = 0
        }
        loading.value = false
        if (!term) return
        if (m.width && m.height && (m.width !== term.cols || m.height !== term.rows)) term.resize(m.width, m.height)
        const current = term
        current.write(b64ToBytes(m.bytes || ''), () => selectionHint.refresh(current))
      } else if (m.type === 'terminal.closed') {
        closedReason = terminalClosedText(m)
      } else if (m.type === 'herdr.stderr') {
        if (!/^run 'herdr --help'/.test(m.message)) lastErr = m.message
      } else if (m.type === 'web.error') {
        toast(m.message, true)
      }
    }
    ws.onclose = () => {
      if (tws !== ws) return
      tws = null
      loading.value = false
      if (!twsIntent || disposed) return
      if (closedReason && /already has an attached client/.test(closedReason)) {
        return opts.setBanner({ text: t('This terminal is already open elsewhere.'), btn: t('Take control'), fn: () => { opts.setBanner(null); connect(true) } })
      }
      if (closedReason && /taken over/.test(closedReason)) {
        return opts.setBanner({ text: t('Another client took control.'), btn: t('Take back control'), fn: () => { opts.setBanner(null); connect(true) } })
      }
      if (!currentPane.value && herdrState.value.ok) return // pane closed: the banner is already there
      if (document.hidden) return // we will reconnect on return
      // Repeated failures without a single frame: we stop and show the error
      // rather than loop.
      if (!gotFrame && twsRetry >= 3) {
        twsRetry = 0
        const why = lastErr || closedReason
        return opts.setBanner({ text: terminalUnavailableText(why), btn: t('Retry'), fn: () => { opts.setBanner(null); connect(false) } })
      }
      twsTimer = setTimeout(() => connect(false), Math.min(6000, 400 * 2 ** twsRetry++))
    }
  }

  function disconnect() {
    twsIntent = false
    clearTimeout(twsTimer)
    if (tws) {
      const ws = tws
      tws = null
      try { ws.close(1000) }
      catch { /* already closed */ }
    }
  }
  const isConnected = () => Boolean(tws && tws.readyState <= 1)

  function reset() { term?.reset() }
  function focus() {
    term?.focus()
    kbdOn.value = true
  }
  function blur() { term?.textarea?.blur() }
  // Tap on the touch layer: opens the link under the finger, if any.
  const tapLink = (x: number, y: number) => links?.tap(x, y) ?? false
  const hasFocus = () => Boolean(term && document.activeElement === term.textarea)
  const rowHeight = () => (term && term.rows && el ? el.clientHeight / term.rows : 16)
  const pageRows = () => term?.rows || 24
  // Scrolling requested from Herdr (the history lives there).
  function scroll(lines: number): boolean {
    return sendTerm({ type: 'terminal.scroll', direction: lines > 0 ? 'up' : 'down', lines: Math.abs(lines) })
  }

  function setVisible(visible: boolean) {
    sendTerm({ type: 'visibility', visible })
    // Another client may have resized the pane while we were away.
    if (visible) nextTick(() => fitNow(true))
  }

  function dispose() {
    disposed = true
    disconnect()
    unbindSelection?.()
    unbindFonts?.()
    unbindFonts = null
    unbindSelection = null
    links?.dispose()
    links = null
    webgl = null // term.dispose() destroys its addons
    term?.dispose()
    term = null
  }

  return {
    mount, connect, disconnect, isConnected, sendTerm, sendKeys, fitNow, setFontSize,
    reset, scroll, focus, blur, tapLink, hasFocus, rowHeight, pageRows, setVisible, dispose, loading, kbdOn,
    hasBanner: opts.hasBanner, selectionHint,
  }
}

export type TerminalCtl = ReturnType<typeof createTerminal>
