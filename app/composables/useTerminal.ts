// Terminal d'un pane : xterm.js relié à /ws/term (frames ANSI de Herdr).
// Herdr garde l'historique : pas de scrollback local, le défilement est
// demandé au serveur (terminal.scroll).
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { terminalPixelWidth } from '~/utils/terminalSize'
import { bindTerminalSelection, type TerminalSelection } from '~/utils/terminalSelection'
import { bindShiftEnter } from '~/utils/terminalKeys'
import { terminalClosedText, terminalUnavailableText } from '~/utils/terminalClosed'

const TERM_FONT = '"Wherdr Symbols", "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace'

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
  let selection: TerminalSelection | null = null

  const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

  function mount(host: HTMLElement) {
    el = host
    disposed = false
    twsRetry = 0
    term = new Terminal({
      fontFamily: TERM_FONT,
      fontSize: fontSize.value,
      // Interligne 1 : les caractères de bloc (logo de Claude Code) et les
      // traits box-drawing doivent se toucher d'une ligne à l'autre.
      lineHeight: 1,
      scrollback: 0, // Herdr garde l'historique ; on fait défiler côté serveur
      cursorBlink: false,
      allowProposedApi: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      // Palette du thème de l'app (Réglages → Thème), mise à jour à chaud.
      theme: terminalTheme.value,
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    // Glisser près du bord : Herdr fait défiler ; copie au relâchement.
    selection = bindTerminalSelection(term, {
      scroll: lines => scroll(lines),
      focus: () => focus(),
      copied: ok => toast(ok ? t('Copié') : t('Copie impossible'), false, ok ? undefined : t('Le navigateur refuse l’accès au presse-papiers.')),
    })
    // Le choix de l'appareil peut changer pendant que le terminal reste monté.
    setRenderer(terminalRenderer.value)
    // JetBrains Mono (embarquée) : une fois chargée, xterm remesure ses cellules.
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
    const ta = term.textarea
    if (ta) {
      ta.setAttribute('autocorrect', 'off')
      ta.setAttribute('autocapitalize', 'off')
      ta.setAttribute('spellcheck', 'false')
      ta.addEventListener('blur', () => { kbdOn.value = false })
      ta.addEventListener('focus', () => { kbdOn.value = true })
    }
    // Molette : xterm n'en fait rien (il enverrait ↑/↓ à l'agent, cf.
    // utils/terminalWheel.ts) ; TerminalView la convertit en terminal.scroll.
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

  // Touches logiques (esc, up, shift+tab…), encodées par Herdr selon le mode du
  // terminal : par la WebSocket si elle est ouverte, sinon par l'API.
  async function sendKeys(keys: string[]) {
    if (sendTerm({ type: 'keys', keys })) return
    try {
      await api('/api/input', { pane_id: paneId, keys })
      haptic()
    } catch (err) { toast((err as Error).message, true) }
  }

  function fitNow(send: boolean) {
    if (!term || !fit || !el || !el.parentElement) return
    // FitAddon mesure le parent de .xterm (#term), pas .xterm elle-même.
    // Sur téléphone, l'inset de #term définit déjà sa largeur.
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

  // Changement de thème pendant que le terminal est affiché.
  watch(terminalTheme, (th) => { if (term) term.options.theme = th })
  // La préférence change la largeur en pixels, puis FitAddon remesure.
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
        try { addon?.dispose() } catch { /* addon incomplètement activé */ }
        // WebGL indisponible : xterm garde le rendu HTML.
        reportTerminalRenderer('html-fallback')
      }
    } else {
      reportTerminalRenderer('html')
    }
    // La taille des cellules peut changer avec le moteur de rendu. La molette et
    // la taille du pane restent gérées par fitNow / TerminalView.
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
      catch { /* déjà fermée */ }
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
        current.write(b64ToBytes(m.bytes || ''), () => {
          if (term === current) selection?.frame()
          selectionHint.refresh(current)
        })
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
        return opts.setBanner({ text: t('Ce terminal est déjà ouvert ailleurs.'), btn: t('Prendre la main'), fn: () => { opts.setBanner(null); connect(true) } })
      }
      if (closedReason && /taken over/.test(closedReason)) {
        return opts.setBanner({ text: t('Un autre client a pris la main.'), btn: t('Reprendre'), fn: () => { opts.setBanner(null); connect(true) } })
      }
      if (!currentPane.value && herdrState.value.ok) return // pane fermé : la bannière est déjà là
      if (document.hidden) return // on se reconnectera au retour
      // Échecs répétés sans une seule image : on arrête et on montre l'erreur
      // plutôt que de boucler.
      if (!gotFrame && twsRetry >= 3) {
        twsRetry = 0
        const why = lastErr || closedReason
        return opts.setBanner({ text: terminalUnavailableText(why), btn: t('Réessayer'), fn: () => { opts.setBanner(null); connect(false) } })
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
      catch { /* déjà fermée */ }
    }
  }
  const isConnected = () => Boolean(tws && tws.readyState <= 1)

  function reset() { term?.reset() }
  function focus() {
    term?.focus()
    kbdOn.value = true
  }
  function blur() { term?.textarea?.blur() }
  const hasFocus = () => Boolean(term && document.activeElement === term.textarea)
  const rowHeight = () => (term && term.rows && el ? el.clientHeight / term.rows : 16)
  const pageRows = () => term?.rows || 24
  // Défilement demandé à Herdr (l'historique vit chez lui).
  function scroll(lines: number): boolean {
    return sendTerm({ type: 'terminal.scroll', direction: lines > 0 ? 'up' : 'down', lines: Math.abs(lines) })
  }

  function setVisible(visible: boolean) {
    sendTerm({ type: 'visibility', visible })
    // Un autre client peut avoir redimensionné le pane pendant notre absence.
    if (visible) nextTick(() => fitNow(true))
  }

  function dispose() {
    disposed = true
    disconnect()
    selection?.dispose()
    selection = null
    webgl = null // term.dispose() détruit ses addons
    term?.dispose()
    term = null
  }

  return {
    mount, connect, disconnect, isConnected, sendTerm, sendKeys, fitNow, setFontSize,
    reset, scroll, focus, blur, hasFocus, rowHeight, pageRows, setVisible, dispose, loading, kbdOn,
    hasBanner: opts.hasBanner, selectionHint,
  }
}

export type TerminalCtl = ReturnType<typeof createTerminal>
