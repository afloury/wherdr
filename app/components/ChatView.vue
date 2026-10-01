<script setup lang="ts">
// Conversation : la transcription de l'agent (sans toucher au terminal, donc
// sans redimensionner le pane que l'ordinateur regarde), relue toutes les 1,5 s (le serveur
// répond « inchangé » tant que le fichier n'a pas grossi).
// Affiché = pages plus anciennes chargées à la demande (`older`, jusqu'à
// l'octet `olderCursor`) + bas relu en continu depuis l'octet `tailStart`.
import type { ChatItem, ChatResponse, ClaudeQueueEntry, Pane, QueuedMessage } from '#shared/types'
import { readOffline, saveChat, touchChat } from '~/utils/offlineCache'
import { mayReadOffline, readOfflineAccess } from '~/utils/offlineAccess'
import { canCancelQueued, restoreDraft } from '~/utils/queuedCancel'
import { queuedPhases } from '#shared/queuedPhase'
import { clampRange, createSelectionSettler, lastLineRect, selectionReplyPos } from '~/utils/selectionReply'
import { pickTyping, replyId } from '~/utils/typewriter'
import { restoredScrollTop, saveReadingPosition } from '~/utils/readingPosition'
import { isStale, noMisses, onError, onUnavailable, type ChatMisses } from '~/utils/chatMiss'
import { dropReplyMarker, findReplyOrigin, parseReply, replyTarget, type ReplyTarget } from '#shared/replyQuote'

const props = defineProps<{ pane: Pane, localQueued: QueuedMessage[] }>()
const route = useRoute()
const emit = defineEmits<{ gotoTerm: [], restored: [], reply: [] }>()
const searchOpen = defineModel<boolean>('search', { default: false })

const box = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

interface ChatData {
  file: string | null
  token: string
  tailStart: number | null
  older: ChatItem[]
  olderCursor: number
  tail: ChatItem[]
  queue: ClaudeQueueEntry[]
}
const fresh = (): ChatData => ({ file: null, token: '', tailStart: null, older: [], olderCursor: 0, tail: [], queue: [] })
const chat = shallowRef<ChatData>(fresh())
const items = computed(() => chat.value.older.concat(chat.value.tail))
const unavailable = ref<'not_found' | 'unsupported' | null>(null)
const loadError = ref<string | null>(null)
const misses = shallowRef<ChatMisses>(noMisses()) // sondages ratés, vue gardée
const rendered = ref(false)
const olderBusy = ref(false)
const savedAt = ref<number | null>(null)
const readOnly = computed(() => offlineView.value || paneStale(props.pane))
async function restoreChat() {
  if (!mayReadOffline(readOfflineAccess())) return
  const saved = (await readOffline()).chats.find(c => c.id === props.pane.id)
  if (!saved || items.value.length) return
  await apply(() => {
    chat.value = { ...fresh(), tail: saved.items }
    savedAt.value = saved.at
  })
  touchChat(props.pane.id)
}

// ------------------------------------------------------------ défilement
const nearEnd = (px: number) => {
  const b = box.value
  return !b || b.scrollHeight - b.scrollTop - b.clientHeight < px
}
function scrollToEnd(force: boolean) {
  const b = box.value
  if (!b) return
  if (force || stick || nearEnd(160)) {
    stick = true
    requestAnimationFrame(() => { b.scrollTop = b.scrollHeight })
  }
}
// Met à jour la conversation en gardant la lecture en cours : collé en bas si
// on y était (ou au premier affichage), sinon à la même place.
async function apply(update: () => void, keepScroll = false) {
  const wasNear = stick || nearEnd(120)
  const first = !rendered.value
  update()
  await nextTick()
  rendered.value = true
  // Retour à une conversation déjà lue : même position (cf. readingPosition.ts),
  // une fois sa session connue.
  let restoreTop: number | null = null
  if (restoring && chat.value.file && box.value) {
    restoring = false
    restoreTop = restoredScrollTop(props.pane.id, chat.value.file, box.value.scrollHeight)
  }
  if (!jumping && searchOpen.value && search.q.length >= 2) applySearchMarks(false)
  else if (restoreTop !== null && !jumping && box.value) {
    stick = false
    box.value.scrollTop = restoreTop
  }
  else if (!keepScroll && (wasNear || first)) scrollToEnd(true)
}
// Ouverte sur un résultat de recherche : c'est lui qu'on montre.
let restoring = typeof route.query.hit !== 'string'
// Collé en bas : la conversation y reste quand la zone rétrécit (question de
// l'agent, clavier, photos jointes) ou que du contenu arrive.
let stick = true
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(() => {
    const b = box.value
    if (b && stick) b.scrollTop = b.scrollHeight
  })
  if (box.value) ro.observe(box.value)
  // Contenu qui grandit après coup (images chargées, blocs dépliés).
  if (listEl.value) ro.observe(listEl.value)
})
onBeforeUnmount(() => {
  if (box.value && rendered.value) saveReadingPosition(props.pane.id, chat.value.file, box.value)
})
onUnmounted(() => ro?.disconnect())
function onScroll() {
  const b = box.value
  if (!b) return
  stick = b.scrollHeight - b.scrollTop - b.clientHeight < 120
  if (b.scrollTop < 400 && rendered.value) loadOlder() // défilement infini vers le haut
}

// ------------------------------------------------------------ machine à écrire
// Seule une réponse arrivée pendant qu'on suit la conversation se déroule
// (ChatMarkdown) : jamais au premier chargement, au retour dans l'app ou après
// le hors-ligne, ni pour les tranches plus anciennes.
const knownReplies = new Set<string>()
const typing = ref<{ id: string, at: number } | null>(null)
let synced = false // premier chargement depuis le serveur fait
let away = false // app en arrière-plan ou hors ligne depuis la dernière relecture
watch(pageVisible, (v) => { if (!v) away = true })
watch(offlineView, (v) => { if (v) away = true })
function noteReplies(list: ChatItem[]) {
  const live = synced && !away && typewriterActive.value && !searchOpen.value && !readOnly.value
  away = false
  synced = true
  const id = pickTyping(knownReplies, list.filter(i => i.role === 'assistant').map(replyId), live)
  if (id) typing.value = { id, at: Date.now() }
}
const typingAt = (id: string) => (typing.value && typing.value.id === id ? typing.value.at : null)
function typingDone(id: string) { if (typing.value?.id === id) typing.value = null }
watch([typewriterActive, searchOpen], ([on, s]) => { if (!on || s) typing.value = null })

// ------------------------------------------------------------ chargement
let busy = false
async function loadChat(): Promise<void> {
  if (busy) return
  busy = true
  const pane = props.pane.id
  try {
    const q = new URLSearchParams({ pane, since: chat.value.token })
    if (chat.value.tailStart !== null) q.set('from', String(chat.value.tailStart))
    const r = await api<ChatResponse>(`/api/chat?${q}`)
    if (pane !== props.pane.id) return
    if (!r.available) {
      const m = onUnavailable(misses.value, Boolean(chat.value.file) && items.value.length > 0)
      misses.value = m.next
      if (!m.clear) return
      chat.value = fresh()
      unavailable.value = r.reason || 'unsupported'
      // Conversation ouverte avant sa première réponse : celle-ci est nouvelle.
      synced = true
      return
    }
    unavailable.value = null
    loadError.value = null
    if (misses.value.misses || misses.value.errors) misses.value = noMisses()
    if (r.unchanged) return
    savedAt.value = null
    // Nouvelle session (/clear, nouvel agent) : les octets de l'ancienne ne
    // veulent plus rien dire, on repart du bas.
    if (chat.value.file && r.file !== chat.value.file) {
      chat.value = fresh()
      synced = false
      busy = false
      return loadChat()
    }
    await apply(() => {
      const c = { ...chat.value }
      if (c.tailStart === null) {
        c.tailStart = r.start ?? 0
        c.olderCursor = r.start ?? 0
      }
      c.file = r.file || null
      c.token = r.token || ''
      c.tail = r.items || []
      c.queue = r.queue || []
      chat.value = c
      noteReplies(c.tail)
    })
    saveChat(pane, items.value)
  } catch (err) {
    if (pane !== props.pane.id) return
    if (!items.value.length) loadError.value = (err as Error).message
    else misses.value = onError(misses.value)
  } finally { busy = false }
}

// Tranche plus ancienne, en gardant à l'écran ce qu'on était en train de lire.
async function loadOlder() {
  if (olderBusy.value || !(chat.value.olderCursor > 0)) return
  olderBusy.value = true
  const pane = props.pane.id
  const file = chat.value.file
  const before = chat.value.olderCursor
  try {
    const r = await api<ChatResponse>(`/api/chat?pane=${encodeURIComponent(pane)}&before=${before}`)
    if (pane !== props.pane.id || r.file !== file || chat.value.olderCursor !== before) return
    const b = box.value
    const fromBottom = b ? b.scrollHeight - b.scrollTop : 0
    await apply(() => {
      chat.value = {
        ...chat.value,
        older: (r.items || []).concat(chat.value.older),
        // pas d'avancée : on s'arrête là
        olderCursor: (r.start ?? 0) < before ? (r.start ?? 0) : 0,
      }
    }, true)
    saveChat(pane, items.value)
    if (b) b.scrollTop = b.scrollHeight - fromBottom
  } catch (err) {
    toast((err as Error).message, true)
  } finally {
    olderBusy.value = false
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  restoreChat().then(loadChat).then(jumpToResult)
  timer = setInterval(() => { if (!document.hidden && !offlineView.value) loadChat() }, 1500)
})
onUnmounted(() => clearInterval(timer))
watch(pageVisible, (v) => { if (v) loadChat() })

// ------------------------------------------------------------ rendu
// Short tool nouns: written as pairs because "Read" or "Search" mean something else elsewhere.
const TOOL_COMMAND = tl('Command', 'Commande'), TOOL_EDIT = tl('Edit', 'Modif'), TOOL_SUBAGENT = tl('Subagent', 'Sous-agent')
const TOOL_LABEL: Record<string, string> = {
  Bash: TOOL_COMMAND, Read: tl('Read', 'Lecture'), Write: tl('Write', 'Écriture'), Edit: TOOL_EDIT, MultiEdit: TOOL_EDIT, Grep: tl('Search', 'Recherche'),
  Glob: tl('Files', 'Fichiers'), WebFetch: 'Web', WebSearch: tl('Web search', 'Recherche web'), Task: TOOL_SUBAGENT, Agent: TOOL_SUBAGENT,
  TodoWrite: tl('Tasks', 'Tâches'), exec: TOOL_COMMAND, shell: TOOL_COMMAND, apply_patch: TOOL_EDIT,
}
const TOOL_ICON: Record<string, string> = {
  Bash: 'i-lucide-terminal', exec: 'i-lucide-terminal', shell: 'i-lucide-terminal',
  Read: 'i-lucide-file-text', Write: 'i-lucide-file-plus', Edit: 'i-lucide-file-pen', MultiEdit: 'i-lucide-file-pen',
  apply_patch: 'i-lucide-file-pen', NotebookEdit: 'i-lucide-file-pen', Grep: 'i-lucide-text-search', Glob: 'i-lucide-folder-search',
  WebFetch: 'i-lucide-globe', WebSearch: 'i-lucide-search', Task: 'i-lucide-bot', Agent: 'i-lucide-bot',
  TodoWrite: 'i-lucide-list-todo', AskUserQuestion: 'i-lucide-message-circle-question',
}
// « exec » de Codex lance du code : une commande shell, ou un autre outil (write_stdin…).
const isOtherTool = (tool: ChatItem) => tool.name === 'exec' && /^\w+$/.test(tool.text || '')
const toolLabel = (tool: ChatItem) => isOtherTool(tool) ? t('Tool') : TOOL_LABEL[tool.name || ''] || tool.name || ''
const toolIcon = (tool: ChatItem) => (tool.error ? 'i-lucide-circle-x' : isOtherTool(tool) ? 'i-lucide-wrench' : TOOL_ICON[tool.name || ''] || 'i-lucide-wrench')
// Notes d'omp (custom_message affichés) : [libellé, icône] par type.
const NOTICE: Record<string, [string, string]> = {
  'advisor': ['Advisor', 'i-lucide-lightbulb'],
  'async-result': ['Background job done', 'i-lucide-circle-check'],
  'irc:incoming': ['Agent message', 'i-lucide-message-square'],
  'launch-completion': ['Process', 'i-lucide-cpu'],
  'lsp-late-diagnostic': ['Diagnostics', 'i-lucide-triangle-alert'],
  'background-tan-dispatch': ['Background task', 'i-lucide-bot'],
}

const UPLOAD_RE = /\/\.cache\/herdr-web\/uploads\/\S+/g
type Block =
  | { k: 'day', key: string, label: string }
  | { k: 'who', key: string }
  | { k: 'user', key: string, text: string, srcs: string[], time: string | null, at: string | null, reply: ReplyTarget | null, origin: string | null }
  | { k: 'assistant', key: string, id: string, text: string, html: string, time: string | null, endsTurn: boolean }
  | { k: 'system', key: string, text: string }
  | { k: 'notice', key: string, label: string, icon: string, html: string, long: boolean }
  | { k: 'shell', key: string, bash: boolean, text: string, out: string, err: string, lines: number, long: boolean }
  | { k: 'tools', key: string, list: ChatItem[], live: boolean }
  | { k: 'turn', key: string, text: string, copy: string | null, reply: string | null }

const openTools = reactive(new Set<string>())
const working = computed(() => !readOnly.value && props.pane.status === 'working')

const blocks = computed<Block[]>(() => {
  const out: Block[] = []
  const list = items.value
  const c = chat.value
  let tools: ChatItem[] = []
  // Clé stable d'un bloc d'actions (garde son état déplié quand des pages
  // plus anciennes s'ajoutent au-dessus).
  const seen = new Map<string, number>()
  const flush = () => {
    if (!tools.length) return
    const f = tools[0]!
    const base = `t:${f.ts}:${f.text}`
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    out.push({ k: 'tools', key: `${base}#${n}`, list: tools, live: false })
    tools = []
  }
  // Un « tour » = un message de l'utilisateur et tout ce que l'agent fait
  // ensuite. À sa fin : « ✓ 2 min 5 s · 7 actions », comme « Worked for… ».
  let turn: { start: string | null, end: string | null, tools: number, replies: number } | null = null
  let lastDay = ''
  // Nom de l'agent en tête de chacune de ses réponses (une fois par tour).
  let needWho = true
  // Dernière réponse d'un tour : copiable depuis la ligne de fin de tour.
  let lastReply: string | null = null
  let lastReplyBlock: (Block & { k: 'assistant' }) | null = null
  const replies: { key: string, time: string | null, text: string }[] = []
  const closeTurn = () => {
    if (turn && turn.end && turn.start && (turn.tools || turn.replies)) {
      const s = Math.max(0, Math.round((Date.parse(turn.end) - Date.parse(turn.start)) / 1000))
      const acts = turn.tools ? ` · ${turn.tools} ${t(turn.tools > 1 ? 'actions' : 'action')}` : ''
      // « Répondre » de la dernière réponse : à côté de « Copier », sur la ligne de fin de tour.
      if (lastReplyBlock) lastReplyBlock.endsTurn = true
      out.push({ k: 'turn', key: `e:${out.length}`, text: `✓ ${fmtDuration(s)}${acts}`, copy: lastReply, reply: lastReplyBlock?.key || null })
    }
    turn = null
    lastReply = null
    lastReplyBlock = null
  }
  list.forEach((it, i) => {
    if (it.ts) {
      const day = new Date(it.ts).toDateString()
      if (day !== lastDay) {
        if (it.role !== 'tool') {
          flush()
          if (it.role === 'user') closeTurn()
        }
        if (lastDay) out.push({ k: 'day', key: `d:${day}`, label: dayLabel(it.ts) })
        lastDay = day
      }
    }
    if (it.role === 'user' || it.role === 'cmd' || it.role === 'bash') {
      flush()
      closeTurn()
      needWho = true
      // La sortie d'une commande « ! » part aussi à l'agent, qui peut y répondre.
      if (it.role !== 'cmd') turn = { start: it.ts, end: null, tools: 0, replies: 0 }
    } else if (turn && it.ts && it.role !== 'notice') {
      // Une note (tâche de fond finie après coup…) ne prolonge pas le tour.
      turn.end = it.ts
      if (it.role === 'tool') turn.tools++
      else if (it.role === 'assistant') turn.replies++
    }
    if ((it.role === 'tool' || it.role === 'assistant') && needWho) {
      needWho = false
      out.push({ k: 'who', key: `w:${it.ts}:${i}` })
    }
    if (it.role === 'tool') {
      tools.push(it)
      return
    }
    flush()
    const key = `${it.role}:${it.ts}:${i}`
    if (it.role === 'user') {
      const uploads = it.text.match(UPLOAD_RE) || []
      const text = it.text.replace(/^.*\/\.cache\/herdr-web\/uploads\/\S+\s*$/gm, '').trim()
      // Images relues dans la transcription (ref = position du message dans le
      // fichier), ou photos déposées sur le serveur dont le chemin est resté en texte.
      const srcs: string[] = []
      if (it.ref && it.images && c.file) {
        for (let k = 0; k < Math.min(it.images, 6); k++) {
          srcs.push(`/api/chat/image?pane=${encodeURIComponent(props.pane.id)}&file=${encodeURIComponent(c.file)}&ref=${it.ref}&i=${k}`)
        }
      }
      for (const u of uploads) srcs.push(`/uploads/${encodeURIComponent(u.split('/').pop()!)}`)
      // Réponse à un message précis : le repère devient une citation qui renvoie à l'original.
      const parsed = parseReply(text)
      const origin = parsed ? findReplyOrigin(replies, parsed.reply)?.key || null : null
      out.push({ k: 'user', key, text: parsed ? parsed.body : text, srcs, time: it.ts ? fmtTime(it.ts) : null, at: it.ts ? fmtDateTime(it.ts) : null, reply: parsed?.reply || null, origin })
    } else if (it.role === 'assistant') {
      lastReply = it.text
      const time = it.ts ? fmtTime(it.ts) : null
      lastReplyBlock = { k: 'assistant', key, id: replyId(it), text: it.text, html: md(it.text), time, endsTurn: false }
      out.push(lastReplyBlock)
      replies.push({ key, time, text: it.text })
    } else if (it.role === 'bash') {
      const o = it.out || ''
      const e = it.err || ''
      const lines = (o ? o.split('\n').length : 0) + (e ? e.split('\n').length : 0)
      out.push({ k: 'shell', key: `s:${it.ts}:${it.text.slice(0, 40)}`, bash: it.role === 'bash', text: it.text, out: o, err: e, lines, long: lines > SHELL_LINES || o.length + e.length > 1500 })
    } else if (it.role === 'notice') {
      const [label, icon] = NOTICE[it.name || ''] || [it.name || 'Note', 'i-lucide-info']
      out.push({ k: 'notice', key, label: t(label), icon, html: md(it.text), long: it.text.split('\n').length > SHELL_LINES || it.text.length > 1200 })
    } else {
      const effort = it.role === 'system' ? it.text.match(/^Effort : (low|medium|high|xhigh|max|ultracode) \(cette session\)$/) : null
      // Commande locale « / » : séparateur système d'une ligne (« /cost → … »).
      out.push({ k: 'system', key, text: effort
        ? tl(`Effort: ${effort[1]} (this session)`, `Effort : ${effort[1]} (cette session)`)
        : it.role === 'system' ? t(it.text) : it.text })
    }
  })
  flush()
  // Dernier tour : résumé seulement s'il est fini (l'agent ne travaille plus).
  if (!working.value && !props.pane.pendingPrompt) closeTurn()
  else {
    // En cours : la dernière action est celle qui tourne.
    const last = out[out.length - 1]
    if (last && last.k === 'tools' && working.value) last.live = true
  }
  return out
})

// Sortie d'une commande : repliée au-delà de quelques lignes.
const SHELL_LINES = 12
// Bloc d'actions : trois ou moins, une ligne chacune ; au-delà, repliées
// derrière « N actions · dernière action ».
const isOpen = (key: string) => openTools.has(key)
function setOpen(key: string, v: boolean) {
  if (v) openTools.add(key)
  else openTools.delete(key)
}

// « Répondre » sous un message : répond au message entier. Un passage
// sélectionné dans un message de l'agent fait apparaître un bouton flottant
// « Répondre » juste après lui, une fois la sélection terminée (cf. utils/selectionReply.ts).
const msgEl = (key: string) => [...(listEl.value?.querySelectorAll<HTMLElement>('[data-hit-key]') || [])].find(el => el.dataset.hitKey === key) || null
function replyTo(key: string, selection = '') {
  const b = blocks.value.find(x => x.key === key)
  if (!b || b.k !== 'assistant') return
  useDraft(props.pane.id).reply = replyTarget(b.text, b.time || '', language === 'en' ? 'en' : 'fr', selection)
  selReply.value = null
  window.getSelection()?.removeAllRanges()
  haptic()
  emit('reply')
}
const selReply = ref<{ key: string, text: string, sig: string, top: number, left: number } | null>(null)
const selBtn = ref<HTMLElement | null>(null)
const isTouch = () => window.matchMedia('(pointer: coarse)').matches
// Sélection courante dans un message de l'agent : texte, fin (dernière ligne) et signature.
function currentSelection() {
  const sel = window.getSelection()
  const range = sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0) : null
  const start = range ? (range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement) : null
  // Message du début de la sélection ; la plage est rognée à son contenu (cf. clampRange).
  const host = start?.closest<HTMLElement>('.msg-ai[data-hit-key]')
  if (!range || !host || readOnly.value || !listEl.value?.contains(host)) return null
  const clamped = clampRange(range, host.querySelector('.md') || host)
  const text = clamped?.toString().trim() || ''
  if (!clamped || !text) return null
  const end = lastLineRect(clamped.getClientRects()) || clamped.getBoundingClientRect()
  return { host, text, end, sig: `${text}|${Math.round(end.right)}|${Math.round(end.top)}` }
}
function showSelectionReply() {
  const cur = currentSelection()
  if (!cur || !listEl.value) { selReply.value = null; return }
  const view = listEl.value.getBoundingClientRect()
  const pos = selectionReplyPos(cur.end, { width: selBtn.value?.offsetWidth || 104, height: selBtn.value?.offsetHeight || 32 }, { width: window.innerWidth, top: Math.max(0, view.top), bottom: Math.min(window.innerHeight, view.bottom) }, isTouch())
  selReply.value = pos ? { key: cur.host.dataset.hitKey!, text: cur.text, sig: cur.sig, ...pos } : null
}
const settler = createSelectionSettler({ show: showSelectionReply, hide: () => { selReply.value = null }, touch: isTouch })
const onSelDown = (e: PointerEvent) => { if (e.button === 0 && !(e.target as Element | null)?.closest?.('.sel-reply')) settler.down() }
const onSelUp = () => settler.up()
const onSelChange = () => settler.change(!!selReply.value && currentSelection()?.sig === selReply.value.sig)
const onSelScroll = () => { if (selReply.value || window.getSelection()?.isCollapsed === false) settler.scroll() }
onMounted(() => {
  document.addEventListener('pointerdown', onSelDown, true)
  document.addEventListener('pointerup', onSelUp, true)
  document.addEventListener('pointercancel', onSelUp, true)
  document.addEventListener('selectionchange', onSelChange)
  window.addEventListener('scroll', onSelScroll, true)
  window.addEventListener('resize', onSelScroll)
})
onUnmounted(() => {
  settler.dispose()
  document.removeEventListener('pointerdown', onSelDown, true)
  document.removeEventListener('pointerup', onSelUp, true)
  document.removeEventListener('pointercancel', onSelUp, true)
  document.removeEventListener('selectionchange', onSelChange)
  window.removeEventListener('scroll', onSelScroll, true)
  window.removeEventListener('resize', onSelScroll)
})
// Citation touchée : défile jusqu'au message d'origine et le met en évidence.
function gotoOrigin(key: string | null) {
  const el = key ? msgEl(key) : null
  if (!el) return toast(t('Original message not found (further up the conversation?)'), true)
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.remove('msg-flash')
  void el.offsetWidth
  el.classList.add('msg-flash')
  setTimeout(() => el.classList.remove('msg-flash'), 1700)
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('Copied'))
  } catch { toast(t('Copy failed'), true) }
}
// Blocs de code du markdown : bouton « Copier » (délégation d'événement,
// le HTML vient de v-html).
function onListClick(e: MouseEvent) {
  // Image dans une réponse de l'agent (markdown) : aperçu en grand, comme les nôtres.
  const img = (e.target as HTMLElement).closest?.('.md-body img') as HTMLImageElement | null
  if (img && img.src) { e.preventDefault(); openImage(img.src); return }
  const btn = (e.target as HTMLElement).closest?.('.code-copy') as HTMLElement | null
  if (!btn) return
  const code = btn.closest('.code-block')?.querySelector('pre')
  if (!code) return
  navigator.clipboard.writeText(code.textContent || '').then(() => {
    btn.textContent = t('Copied')
    btn.classList.add('done')
    setTimeout(() => {
      btn.textContent = t('Copy')
      btn.classList.remove('done')
    }, 1400)
  }).catch(() => toast(t('Copy failed'), true))
}

// ------------------------------------------------------------ en attente
// Messages envoyés mais pas encore pris par l'agent : bulles en pointillés
// sous la conversation, jusqu'à ce qu'ils apparaissent dans sa transcription.
// Nos envois pas encore pris + la file propre à Claude (messages tapés sur
// l'ordinateur pendant qu'il travaillait), sans doublons.
// Écran de Claude au travail (lu par le serveur) : la transcription n'a une
// commande « ! » qu'à la fin ; l'écran dit déjà qu'elle tourne, et quels
// messages sont partis ou encore dans sa file (cf. shared/queuedPhase.ts).
const screen = computed(() => (!readOnly.value && props.pane.agent === 'claude' && props.pane.status === 'working' ? props.pane.claudeScreen || null : null))
const liveShell = computed(() => (screen.value && screen.value.shell) || null)
// Durée de la commande en cours, à la seconde.
const nowTick = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
watch(liveShell, (sh) => {
  if (sh && !tick) tick = setInterval(() => { nowTick.value = Date.now() }, 1000)
  if (!sh && tick) { clearInterval(tick); tick = undefined }
}, { immediate: true })
onUnmounted(() => clearInterval(tick))
const shellDuration = computed(() => {
  const since = liveShell.value && liveShell.value.since
  if (!since) return null
  const s = Math.max(0, Math.round((nowTick.value - since) / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
})
const normText = (s: string) => dropReplyMarker(String(s || '').replace(/\s+/g, ' ').trim().toLowerCase())
const isUploadLine = (l: string) => l.includes('/.cache/herdr-web/uploads/')
const queuedList = computed(() => {
  const p = props.pane
  // Déjà dans la conversation (le serveur ne l'a pas encore constaté) : on n'en
  // montre pas deux exemplaires. « ! cmd » y figure comme commande sans « ! ».
  const inChat = (q: QueuedMessage) => {
    const n = normText(q.text.split('\n').filter(l => !isUploadLine(l)).join(' ')).slice(0, 60)
    const nb = normText(q.text.replace(/^\s*!\s*/, '')).slice(0, 60)
    return Boolean(n) && items.value.some(i => (!q.at || !i.ts || Date.parse(i.ts) >= q.at - 10000)
      && (i.role === 'user' ? normText(i.text).includes(n) : i.role === 'bash' && Boolean(nb) && normText(i.text).includes(nb)))
  }
  const mine = readOnly.value ? [] : [...(p.queued || [])]
  for (const q of props.localQueued) if (!mine.some(x => x.id === q.id)) mine.push(q)
  // Ordre d'envoi, quelle que soit la source (serveur ou envoi local).
  mine.sort((a, b) => (a.at && b.at ? a.at - b.at : 0))
  const list: QueuedMessage[] = mine.filter(q => !inChat(q))
  for (const q of chat.value.queue || []) {
    const n = normText(q.text).slice(0, 60)
    if (n && !list.some(x => normText(x.text).includes(n))) list.push({ id: `cc-${q.ts}`, text: q.text })
  }
  const phases = queuedPhases(list.map(q => q.text), screen.value)
  const replies = blocks.value.filter(b => b.k === 'assistant')
  return list.map((q, i) => {
    const lines = q.text.split('\n')
    const text = lines.filter(l => !isUploadLine(l)).join('\n').trim()
    const parsed = parseReply(text)
    return {
      id: q.id,
      raw: q.text,
      mine: !q.id.startsWith('cc-'),
      // Held or failed on the server: never typed yet, so never "sent".
      phase: q.state ? 'queued' : phases[i]!,
      state: q.state || null,
      photos: lines.filter(isUploadLine).map(l => `/uploads/${encodeURIComponent(l.trim().split('/').pop()!)}`),
      text,
      body: parsed ? parsed.body : text,
      reply: parsed?.reply || null,
      origin: parsed ? findReplyOrigin(replies, parsed.reply)?.key || null : null,
    }
  })
})
// « Annuler » : le message sort de la file de l'agent et revient dans le champ
// de saisie. Déjà lu entre-temps : le serveur refuse, on le dit.
const canCancel = computed(() => !readOnly.value && canCancelQueued(props.pane))
const cancelling = ref<string | null>(null)
async function cancelQueued(q: { id: string, raw: string, mine: boolean }) {
  if (cancelling.value) return
  cancelling.value = q.id
  haptic()
  try {
    const r = await api<{ text: string }>('/api/unqueue', { pane_id: props.pane.id, text: q.raw, id: q.mine ? q.id : undefined })
    restoreDraft(useDraft(props.pane.id), r.text || q.raw)
    emit('restored')
    toast(t('Removed from the queue'))
    setTimeout(loadChat, 400)
  } catch (err) {
    toast((err as Error).message, true)
  } finally {
    cancelling.value = null
  }
}
// "Retry" on a message that could not be sent: held again by the server.
const retrying = ref<string | null>(null)
async function retryQueued(q: { id: string }) {
  if (retrying.value) return
  retrying.value = q.id
  haptic()
  try {
    await api('/api/requeue', { pane_id: props.pane.id, id: q.id })
  } catch (err) {
    toast((err as Error).message, true)
  } finally {
    retrying.value = null
  }
}
const queuedWhy = computed(() => {
  const p = props.pane
  if (p.pendingPrompt) return tl(`will be sent when ${kindLabel(p.agent)} is ready`, `partira dès que ${kindLabel(p.agent)} sera prêt`)
  if (p.status === 'working') return t('will be read at the agent’s next step')
  if (p.status === 'blocked') return t('after you answer the question')
  return t('sending…')
})
watch(() => queuedList.value.map(q => `${q.id}:${q.phase}`).join(','), () => nextTick(() => scrollToEnd(false)))
watch(() => liveShell.value && liveShell.value.lines.join('\n'), () => nextTick(() => scrollToEnd(false)))

// Pas encore de conversation mais un écran d'attente (légende de touches) :
// l'agent attend une action. Écran reconnu : détail et boutons dans le panneau
// « À toi » en bas ; sinon aperçu des dernières lignes, à faire dans le terminal.
const waiting = computed(() => {
  const p = props.pane
  if (unavailable.value !== 'not_found' || !p.screen || p.status === 'working' || readOnly.value) return null
  const who = kindLabel(p.agent)
  return knownScreen(p)
    ? { text: tl(`${who} is waiting for your answer, below or in the terminal.`, `${who} attend ta réponse, ci-dessous ou dans le terminal.`), lines: [] }
    : { text: tl(`${who} is waiting for an action in the terminal.`, `${who} attend une action dans le terminal.`), lines: p.screen.lines }
})

const status = computed(() => {
  if (readOnly.value) return null
  const p = props.pane
  if (p.pendingPrompt && p.status !== 'working') {
    return { typing: true, text: tl(`Your first message will be sent when ${kindLabel(p.agent)} is ready`, `Ton premier message partira dès que ${kindLabel(p.agent)} sera prêt`) }
  }
  // Claude : son verbe du moment (« ✻ Orbiting… »), lu à l'écran par le serveur ;
  // l'étoile qui tourne devant est animée côté app (ClaudeSpinner).
  if (liveShell.value) return { typing: true, text: tl('Command running…', 'Commande en cours…') }
  if (p.status === 'working' && p.agent === 'claude' && p.activity) return { typing: true, verb: true, text: `${p.activity}…` }
  if (p.status === 'working') return { typing: true, text: `${kindLabel(p.agent)} ${tl('is working…', 'travaille…')}` }
  if (p.status === 'blocked' && !(p.prompt && p.prompt.options) && !knownScreen(p)) return { typing: false, text: t('Waiting for your reply — details in the Terminal tab') }
  return null
})
watch(() => props.pane.status, () => nextTick(() => scrollToEnd(false)))

// ------------------------------------------------------------ recherche
// Charge toute la conversation, puis surligne les occurrences (CSS Custom
// Highlight API : rien n'est modifié dans le DOM rendu par Vue) et permet de
// les parcourir.
const search = reactive({ q: '', hits: [] as Range[], cur: -1, loading: false })
let jumping = false
const searchInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const highlights = (typeof CSS !== 'undefined' && 'highlights' in CSS) ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights : null
type HighlightCtor = new (...r: Range[]) => unknown
const HighlightCls = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight

function clearMarks() {
  highlights?.delete('hw-hit')
  highlights?.delete('hw-cur')
}
function applySearchMarks(jumpToLast: boolean, target?: HTMLElement | null) {
  clearMarks()
  search.hits = []
  if (!searchOpen.value || search.q.length < 2 || !listEl.value) return
  const q = fold(search.q)
  const walker = document.createTreeWalker(listEl.value, NodeFilter.SHOW_TEXT)
  // fold() garde la même longueur que le texte d'origine pour les lettres
  // accentuées usuelles (NFD puis retrait des accents).
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const f = fold(n.nodeValue || '')
    let i = 0
    let j: number
    while ((j = f.indexOf(q, i)) >= 0) {
      const r = document.createRange()
      r.setStart(n, j)
      r.setEnd(n, Math.min(j + q.length, (n.nodeValue || '').length))
      search.hits.push(r)
      i = j + q.length
    }
  }
  if (target) {
    const at = search.hits.findIndex(r => target.contains(r.startContainer))
    search.cur = at >= 0 ? at : 0
  } else if (jumpToLast || search.cur >= search.hits.length) search.cur = search.hits.length - 1
  focusHit()
}
function focusHit() {
  if (highlights && HighlightCls) {
    highlights.set('hw-hit', new HighlightCls(...search.hits.filter((_, k) => k !== search.cur)))
    const cur = search.hits[search.cur]
    if (cur) highlights.set('hw-cur', new HighlightCls(cur))
    else highlights.delete('hw-cur')
  }
  const r = search.hits[search.cur]
  const b = box.value
  if (r && b) {
    const rect = r.getBoundingClientRect()
    const br = b.getBoundingClientRect()
    b.scrollTo({ top: b.scrollTop + rect.top - br.top - b.clientHeight / 2, behavior: 'smooth' })
  }
}
const searchCount = computed(() => search.loading
  ? t('loading…')
  : search.q.length < 2 ? '' : search.hits.length ? `${search.cur + 1}/${search.hits.length}` : t('no results'))
function stepSearch(d: number) {
  if (!search.hits.length) return
  search.cur = (search.cur + d + search.hits.length) % search.hits.length
  focusHit()
}
async function loadAllOlder() {
  while (chat.value.olderCursor > 0) {
    const before = chat.value.olderCursor
    await loadOlder()
    if (chat.value.olderCursor === before) break
  }
}
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
}
async function runSearch() {
  if (search.q.trim().length < 2) {
    clearMarks()
    search.hits = []
    search.cur = -1
    return
  }
  if (chat.value.olderCursor > 0 && !readOnly.value) {
    search.loading = true
    await loadAllOlder()
    search.loading = false
  }
  applySearchMarks(true)
}
async function jumpToResult() {
  const raw = route.query.hit
  const q = route.query.q
  if (typeof raw !== 'string' || typeof q !== 'string' || !/^\d+$/.test(raw)) return
  const offset = Number(raw)
  searchOpen.value = true
  search.q = q
  search.loading = true
  jumping = true
  try {
    // Chaque chargement remonte d'une tranche jusqu'à celle du message visé.
    while (chat.value.olderCursor > offset && !readOnly.value) {
      const before = chat.value.olderCursor
      await loadOlder()
      if (chat.value.olderCursor >= before) break
    }
    await nextTick()
    const role = String(route.query.role || '')
    const ts = String(route.query.ts || '')
    const prefix = String(route.query.prefix || '')
    const index = items.value.findIndex(i => i.role === role && i.ts === ts && i.text.startsWith(prefix))
    const key = index < 0 ? '' : `${role}:${ts}:${index}`
    const target = [...(listEl.value?.querySelectorAll<HTMLElement>('[data-hit-key]') || [])].find(el => el.dataset.hitKey === key)
    applySearchMarks(false, target)
    if (target && !search.hits.length) target.scrollIntoView({ block: 'center' })
  } finally { jumping = false; search.loading = false }
}
watch(() => route.query.hit, () => { if (route.params.pane === props.pane.id) jumpToResult() })
function closeSearch() {
  searchOpen.value = false
}
watch(searchOpen, (open) => {
  if (open) nextTick(() => searchInput.value?.inputRef?.focus())
  else {
    search.q = ''
    search.hits = []
    search.cur = -1
    clearMarks()
  }
})
onUnmounted(clearMarks)
function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    stepSearch(e.shiftKey ? 1 : -1)
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    closeSearch()
  }
}

function openImage(src: string) { lightboxSrc.value = src }

defineExpose({ scrollToEnd, reload: () => setTimeout(loadChat, 400) })
</script>

<template>
  <div v-if="searchOpen" class="search-bar">
    <UInput
      ref="searchInput" v-model="search.q" type="search" enterkeyhint="search" autocomplete="off"
      icon="i-lucide-search" variant="none" :placeholder="t('Search the conversation')" class="flex-1 min-w-0"
      @update:model-value="onSearchInput" @keydown="onSearchKey"
    />
    <span class="search-count">{{ searchCount }}</span>
    <UButton icon="i-lucide-chevron-up" color="neutral" variant="ghost" size="sm" :aria-label="t('Previous')" @click="stepSearch(-1)" />
    <UButton icon="i-lucide-chevron-down" color="neutral" variant="ghost" size="sm" :aria-label="t('Next')" @click="stepSearch(1)" />
    <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" :aria-label="t('Close')" @click="closeSearch" />
  </div>

  <div class="chat-wrap">
    <OfflineNote v-if="readOnly || netDown" :label="readOnly ? t('Offline reading') : undefined" :at="savedAt" />
    <OfflineNote v-else-if="isStale(misses)" :label="t('Conversation not up to date — reconnecting…')" />
    <div ref="box" class="chat" @scroll.passive="onScroll">
      <UChatMessages
        :status="working ? 'streaming' : 'ready'" :should-auto-scroll="false"
        :auto-scroll="{ color: 'neutral', variant: 'outline' }"
        auto-scroll-icon="i-lucide-arrow-down"
        :ui="{ root: 'chat-msgs', viewport: 'hw-jump-vp', autoScroll: 'hw-jump' }"
      >
        <div ref="listEl" class="chat-list" @click="onListClick">
          <div v-if="unavailable && waiting" class="chat-empty waiting">
            <UIcon name="i-lucide-square-terminal" class="chat-empty-icon" />
            <p>{{ waiting.text }}</p>
            <pre v-if="waiting.lines.length" class="choices-screen-text">{{ waiting.lines.join('\n') }}</pre>
            <UButton size="sm" color="neutral" variant="outline" class="mono-btn" icon="i-lucide-square-terminal" @click="emit('gotoTerm')">{{ t('View terminal') }}</UButton>
          </div>
          <div v-else-if="unavailable" class="chat-empty">
            <UIcon name="i-lucide-message-square-dashed" class="chat-empty-icon" />
            <p>{{ unavailable === 'not_found' ? t('No conversation for this agent yet.') : t('Conversation unavailable for this agent.') }}</p>
            <UButton size="sm" color="neutral" variant="outline" class="mono-btn" icon="i-lucide-square-terminal" @click="emit('gotoTerm')">{{ t('View terminal') }}</UButton>
          </div>
          <template v-else>
            <div v-if="chat.olderCursor > 0" class="chat-more">
              <UButton size="xs" color="neutral" variant="outline" class="mono-btn" :loading="olderBusy" icon="i-lucide-arrow-up" @click="loadOlder">
                {{ t('Load earlier messages') }}
              </UButton>
            </div>
            <div v-else-if="chat.older.length" class="chat-note">{{ t('Start of conversation') }}</div>

            <template v-for="b in blocks" :key="b.key">
              <div v-if="b.k === 'day'" class="day-sep"><span>{{ b.label }}</span></div>

              <div v-else-if="b.k === 'who'" class="msg-who" :class="pane.agent || ''">
                <UIcon :name="pane.agent === 'codex' ? 'i-herdr-codex' : pane.agent === 'claude' ? 'i-herdr-claude-code' : 'i-lucide-bot'" /><span>{{ kindLabel(pane.agent) }}</span>
              </div>

              <div v-else-if="b.k === 'user'" class="msg-user-wrap" :data-hit-key="b.key">
                <button v-if="b.reply" type="button" class="msg-quote" :aria-label="t('Show original message')" @click="gotoOrigin(b.origin)">
                  <UIcon name="i-lucide-corner-left-up" class="msg-quote-time" /><span class="msg-quote-time">{{ b.reply.time }}</span><span class="msg-quote-text">{{ b.reply.excerpt }}</span>
                </button>
                <UChatMessage
                  :id="b.key" role="user" side="right" variant="soft"
                  :parts="[...b.srcs.map(url => ({ type: 'file' as const, mediaType: 'image/jpeg', url })), ...(b.text ? [{ type: 'text' as const, text: b.text }] : [])]"
                  :ui="{ root: 'msg msg-user', container: 'msg-c', content: 'msg-bubble', header: 'msg-files' }"
                >
                  <template #files>
                    <span class="thumbs" :class="{ one: b.srcs.length === 1 }"><span v-for="src in b.srcs" :key="src"><span v-if="readOnly" class="offline-image">{{ t('Image unavailable offline') }}</span><img v-else class="msg-img" :src="src" alt="" loading="lazy" decoding="async" @click="openImage(src)"></span></span>
                  </template>
                  <template #content>{{ b.text }}</template>
                </UChatMessage>
                <div v-if="b.time" class="msg-time" :title="b.at || undefined">{{ b.time }}</div>
              </div>

              <template v-else-if="b.k === 'assistant'">
                <UChatMessage
                  :id="b.key" role="assistant" side="left" variant="naked"
                  :data-hit-key="b.key"
                  :parts="[{ type: 'text', text: b.text }]"
                  :ui="{ root: `msg msg-ai tw-${pane.agent || 'agent'}`, container: 'msg-c', content: 'md' }"
                >
                  <template #content>
                    <ChatMarkdown :html="b.html" :typing="typingAt(b.id)" @done="typingDone(b.id)" />
                  </template>
                </UChatMessage>
                <div v-if="!b.endsTurn && !readOnly" class="msg-actions">
                  <button type="button" class="msg-reply" @click="replyTo(b.key)">
                    <UIcon name="i-lucide-reply" /><span>{{ t('Reply') }}</span>
                  </button>
                </div>
              </template>

              <div v-else-if="b.k === 'shell'" class="msg-shell" :class="{ bash: b.bash, long: b.long, open: isOpen(b.key) }">
                <div class="msg-shell-cmd">
                  <span class="msg-shell-sign" aria-hidden="true">{{ b.bash ? '!' : '❯' }}</span>
                  <code>{{ b.text }}</code>
                  <UTooltip :text="t('Copy command')" :disabled="!desk">
                    <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" class="msg-shell-copy" :aria-label="t('Copy command')" @click="copyText(b.bash ? `!${b.text}` : b.text)" />
                  </UTooltip>
                </div>
                <div v-if="b.out || b.err" class="msg-shell-body">
                  <pre v-if="b.out" class="msg-shell-out">{{ b.out }}</pre>
                  <pre v-if="b.err" class="msg-shell-out err">{{ b.err }}</pre>
                </div>
                <div v-else-if="b.bash" class="msg-shell-empty">{{ t('No output') }}</div>
                <button v-if="b.long" type="button" class="msg-shell-more" :aria-expanded="isOpen(b.key)" @click="setOpen(b.key, !isOpen(b.key))">
                  <UIcon :name="isOpen(b.key) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" />
                  <span>{{ isOpen(b.key) ? t('Collapse') : tl(`Show all · ${b.lines} lines`, `Tout afficher · ${b.lines} lignes`) }}</span>
                </button>
              </div>
              <div v-else-if="b.k === 'system'" class="msg-system"><span>{{ b.text }}</span></div>
              <div v-else-if="b.k === 'notice'" class="msg-notice" :class="{ long: b.long, open: isOpen(b.key) }">
                <div class="msg-notice-head"><UIcon :name="b.icon" /><span>{{ b.label }}</span></div>
                <ChatMarkdown class="msg-notice-body md" :html="b.html" :typing="null" />
                <button v-if="b.long" type="button" class="msg-shell-more" :aria-expanded="isOpen(b.key)" @click="setOpen(b.key, !isOpen(b.key))">
                  <UIcon :name="isOpen(b.key) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" />
                  <span>{{ isOpen(b.key) ? t('Collapse') : t('Show all') }}</span>
                </button>
              </div>
              <div v-else-if="b.k === 'turn'" class="turn-end">
                <UTooltip v-if="b.copy" :text="t('Copy reply')" :disabled="!desk">
                  <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" class="turn-copy" :aria-label="t('Copy reply')" @click="copyText(b.copy)" />
                </UTooltip>
                <button v-if="b.reply && !readOnly" type="button" class="msg-reply" @click="replyTo(b.reply)">
                  <UIcon name="i-lucide-reply" /><span>{{ t('Reply') }}</span>
                </button>
                <span>{{ b.text }}</span>
              </div>

              <div v-else-if="b.k === 'tools'" class="tools" :class="{ live: b.live }">
                <template v-if="b.list.length <= 3">
                  <UChatTool
                    v-for="(tool, j) in b.list" :key="j" :text="toolLabel(tool)" :suffix="tool.text" :icon="toolIcon(tool)"
                    :loading="b.live && j === b.list.length - 1" :streaming="b.live && j === b.list.length - 1"
                    :ui="{ root: 'tool', trigger: 'tool-trigger', label: 'tool-label', suffix: 'tool-suffix', leading: 'tool-leading' }"
                    :class="{ err: tool.error }"
                  />
                </template>
                <UChatTool
                  v-else :open="isOpen(b.key)" :text="`${b.list.length} ${t('actions')}`"
                  :suffix="`${toolLabel(b.list[b.list.length - 1]!)} · ${b.list[b.list.length - 1]!.text}`"
                  :icon="b.live ? undefined : 'i-lucide-layers'" :loading="b.live" :streaming="b.live" chevron="trailing"
                  :ui="{ root: 'tool group', trigger: 'tool-trigger', label: 'tool-label', suffix: 'tool-suffix', leading: 'tool-leading', body: 'tool-body', trailingIcon: 'tool-chev' }"
                  @update:open="setOpen(b.key, $event)"
                >
                  <div v-for="(tool, j) in b.list" :key="j" class="tool-row" :class="{ err: tool.error }">
                    <UIcon :name="toolIcon(tool)" /><b>{{ toolLabel(tool) }}</b><span>{{ tool.text }}</span>
                  </div>
                </UChatTool>
              </div>
            </template>
            <div v-if="rendered && !items.length && !loadError" class="chat-empty">
              <UIcon name="i-lucide-message-square-dashed" class="chat-empty-icon" />
              <p>{{ t('No messages yet.') }}</p>
            </div>
            <div v-if="loadError" class="chat-empty"><p>{{ loadError }}</p></div>
          </template>
        </div>

        <Teleport to="body">
          <button
            v-if="selReply" ref="selBtn" type="button" class="sel-reply" :style="{ top: `${selReply.top}px`, left: `${selReply.left}px` }"
            :aria-label="t('Reply to this passage')" @pointerdown.prevent @mousedown.prevent @click="replyTo(selReply.key, selReply.text)"
          >
            <UIcon name="i-lucide-reply" /><span>{{ t('Reply') }}</span>
          </button>
        </Teleport>
        <div v-if="queuedList.length || liveShell" class="queued-list">
          <!-- Déjà partis (visibles comme envoyés à l'écran), pas encore dans la transcription. -->
          <div v-for="q in queuedList.filter(x => x.phase === 'sent')" :key="q.id" class="msg-user-wrap">
            <button v-if="q.reply" type="button" class="msg-quote" :aria-label="t('Show original message')" @click="gotoOrigin(q.origin)">
              <UIcon name="i-lucide-corner-left-up" class="msg-quote-time" /><span class="msg-quote-time">{{ q.reply.time }}</span><span class="msg-quote-text">{{ q.reply.excerpt }}</span>
            </button>
            <div class="msg-bubble sent">
              <span v-if="q.photos.length" class="thumbs" :class="{ one: q.photos.length === 1 }"><img v-for="src in q.photos" :key="src" class="msg-img" :src="src" alt="" @click="openImage(src)"></span>{{ q.body }}
            </div>
            <div class="queued-tag sent"><UIcon name="i-lucide-check" /><span>{{ t('Sent · read by the agent') }}</span></div>
          </div>
          <!-- Commande « ! » en cours : sortie en direct lue à l'écran. -->
          <div v-if="liveShell" class="msg-user-wrap">
            <div class="msg-shell bash running">
              <div class="msg-shell-cmd">
                <span class="msg-shell-sign" aria-hidden="true">!</span>
                <code>{{ liveShell.command }}</code>
              </div>
              <div v-if="liveShell.lines.length" class="msg-shell-body">
                <div v-if="liveShell.hidden" class="msg-shell-hidden">{{ tl(`+ ${liveShell.hidden} lines above`, `+ ${liveShell.hidden} lignes au-dessus`) }}</div>
                <pre class="msg-shell-out">{{ liveShell.lines.join('\n') }}</pre>
              </div>
              <div v-else class="msg-shell-empty">{{ t('No output yet') }}</div>
            </div>
            <div class="queued-tag running">
              <UIcon name="i-lucide-loader-circle" class="spin" /><span>{{ t('Running') }}<template v-if="shellDuration"> · {{ shellDuration }}</template></span>
            </div>
          </div>
          <div v-for="q in queuedList.filter(x => x.phase === 'queued')" :key="q.id" class="msg-user-wrap">
            <button v-if="q.reply" type="button" class="msg-quote" :aria-label="t('Show original message')" @click="gotoOrigin(q.origin)">
              <UIcon name="i-lucide-corner-left-up" class="msg-quote-time" /><span class="msg-quote-time">{{ q.reply.time }}</span><span class="msg-quote-text">{{ q.reply.excerpt }}</span>
            </button>
            <div class="msg-bubble queued">
              <span v-if="q.photos.length" class="thumbs" :class="{ one: q.photos.length === 1 }"><img v-for="src in q.photos" :key="src" class="msg-img" :src="src" alt="" @click="openImage(src)"></span>{{ q.body }}
            </div>
            <div v-if="q.state === 'failed'" class="queued-tag failed" role="alert">
              <UIcon name="i-lucide-circle-alert" /><span>{{ t('Not sent') }}</span>
              <button type="button" class="queued-cancel" :disabled="Boolean(retrying)" @click="retryQueued(q)">
                <UIcon :name="retrying === q.id ? 'i-lucide-loader-circle' : 'i-lucide-rotate-cw'" :class="{ spin: retrying === q.id }" />{{ t('Retry') }}
              </button>
              <button type="button" class="queued-cancel" :disabled="Boolean(cancelling)" @click="cancelQueued(q)">
                <UIcon :name="cancelling === q.id ? 'i-lucide-loader-circle' : 'i-lucide-undo-2'" :class="{ spin: cancelling === q.id }" />{{ t('Cancel') }}
              </button>
            </div>
            <div v-else class="queued-tag">
              <UIcon name="i-lucide-clock" /><span>{{ t('Queued · ') }}{{ q.state === 'held' ? t('will be sent when the menu closes') : queuedWhy }}</span>
              <button v-if="canCancel || q.state" type="button" class="queued-cancel" :disabled="Boolean(cancelling)" @click="cancelQueued(q)">
                <UIcon :name="cancelling === q.id ? 'i-lucide-loader-circle' : 'i-lucide-undo-2'" :class="{ spin: cancelling === q.id }" />{{ t('Cancel') }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="status" class="chat-status" :class="{ typing: status.typing, waiting: !status.typing }">
          <!-- Le verbe de Claude a son étoile animée : pas de point d'état en plus. -->
          <span v-if="'verb' in status" class="claude-verb-line"><ClaudeSpinner /><UChatShimmer :text="status.text" :duration="2.4" class="claude-verb" /></span>
          <template v-else>
            <i class="status-dot" />
            <UChatShimmer v-if="status.typing" :text="status.text" :duration="2.4" />
            <span v-else>{{ status.text }}</span>
          </template>
        </div>
      </UChatMessages>
    </div>
  </div>
</template>
