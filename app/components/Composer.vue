<script setup lang="ts">
// Input bar (UChatPrompt): field on top, + · model and send below,
// like Claude.ai. Agent working and field empty: send becomes "Stop" (Escape),
// via UChatPromptSubmit ("streaming" state).
// Photos shrunk in the browser (2048 px, JPEG) then stored on the server;
// their path goes with the message. Other files the agent can read (PDF,
// text, code, notebooks) are stored on its machine as they are (/api/attach).
import type { Pane, QueuedMessage, SlashCommand } from '#shared/types'
import type { DraftAtt } from '~/composables/useDraft'
import { withReply } from '#shared/replyQuote'
import { quotesIn, removeQuote } from '~/utils/questionReply'
import { isAgentCommand } from '#shared/commandScreen'
import { isSlashCommand } from '#shared/queuedMatch'
import type { AttachKind } from '#shared/attachments'
import { refusalText, sortForAgent } from '~/utils/fileDrop'
import { lostPhotosText, restoreDraft } from '~/utils/queuedCancel'

// `escStops`: Escape is free for Stop (the conversation search, which closes on it, is shut).
// `takeBack`: conversation view; a prompt Claude puts back into its field on Stop
// comes back here instead (never in the terminal view, where the user sees Claude's field).
const props = defineProps<{ pane: Pane | undefined, paneId: string, sendKeys: (keys: string[]) => Promise<void>, escStops?: boolean, takeBack?: boolean }>()
const emit = defineEmits<{ sent: [queued: QueuedMessage | null], showTerminal: [] }>()

// Claude Code update installed: the status line restarts the agent.
// Claude Code error status ("Auto-update failed…"): in red, like in the terminal.
const noticeIsError = computed(() => /\b(failed|error)\b/i.test(props.pane?.claudeNotice || ''))
const updateReady = computed(() => Boolean(props.pane?.claudeNotice && /Restart to update/i.test(props.pane.claudeNotice) && canRestart(props.pane)))
const restartLabel = computed(() => {
  const r = props.pane?.restart
  if (!r) return ''
  const who = kindLabel(r.agent)
  // Codex update in its terminal: one more step between the stop and the relaunch.
  if (r.update && r.phase === 'stopping') return tl(`Exiting ${who}…`, `Fermeture de ${who}…`)
  if (r.phase === 'updating') return tl(`Updating ${who} in its terminal…`, `Mise à jour de ${who} dans son terminal…`)
  return r.phase === 'stopping' ? tl(`Stopping ${who}…`, `Arrêt de ${who}…`) : tl(`Restarting ${who} on the same conversation…`, `Relance de ${who} sur la même conversation…`)
})
async function copyUpdate() {
  const c = props.pane?.restart?.update
  if (!c) return
  try {
    await navigator.clipboard.writeText(c)
    toast(tl('Command copied: paste it into the terminal of this pane.', 'Commande copiée : colle-la dans le terminal de ce panneau.'))
  } catch { toast(t('Copy failed'), true) }
}

// Conversation draft (text + photos), kept when switching conversations.
const draft = useDraft(props.paneId)
const text = toRef(draft, 'text')
const promptRef = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null)
const ta = computed(() => promptRef.value?.textareaRef || null)
const fileInput = ref<HTMLInputElement | null>(null)
const anyFileInput = ref<HTMLInputElement | null>(null)
const sending = ref(false)
// On a touch keyboard, Enter adds a line; the button below the field sends.
const enterSends = computed(() => desk.value && !isIOS && !touchKeyboard)

type Att = DraftAtt
const attachments = toRef(draft, 'atts')
// Reply to a specific agent message: box above the field, short marker on send.
const replyTo = toRef(draft, 'reply')
// Questions and passages quoted in the text ("> " lines, see utils/questionReply.ts):
// one chip each above the field, to remove it.
const quotes = computed(() => quotesIn(text.value))
// Quotes as tokens (Settings › Conversation, utils/quoteTokens.ts): the rich
// field replaces the plain one while the draft holds a quote. Not while the
// plain field has the focus: a ">" typed there does not swap fields mid-word.
const tokensRef = ref<{ focus: () => void, focusEnd: () => void, blur: () => void } | null>(null)
const taFocused = ref(false)
const tokensMode = computed(() => quoteTokensActive.value && quotes.value.length > 0 && !taFocused.value)
// Last token removed while typing in the rich field: the caret goes on in the plain one.
watch(tokensMode, (on, was) => {
  if (was && !on && document.activeElement?.closest('.rb-field')) nextTick(focusEnd)
})

const canSend = computed(() => Boolean(text.value.trim() || attachments.value.length))
const readOnly = computed(() => !eventsOpen.value || offlineView.value || paneStale(props.pane))
// Offline, no Stop: UChatPromptSubmit ignores `disabled` in "streaming" mode.
// omp running the user's "!" / "$" command stays idle: Stop cancels the command.
const shellRun = computed(() => Boolean(props.pane && props.pane.agent === 'omp' && props.pane.ompShell && props.pane.status !== 'working'))
const stopMode = computed(() => Boolean(!readOnly.value && props.pane && props.pane.agent && (props.pane.status === 'working' || shellRun.value) && !canSend.value))
// Claude Code's grayed-out suggestion (see parseClaudeSuggestion): placeholder of the
// empty field; Tab (or the chip, on a touch screen) puts it in the field, without sending it.
const suggestion = computed(() => (!readOnly.value && !canSend.value && props.pane?.claudeSuggestion) || null)
function useSuggestion() {
  const s = suggestion.value
  if (!s) return
  text.value = s
  focusEnd()
}
const placeholder = computed(() => {
  const p = props.pane
  if (!p) return t('Message to agent…')
  if (p.status === 'blocked') return t('Type a reply…')
  if (suggestion.value) return suggestion.value
  if (p.agent) return tl(`Message to ${kindLabel(p.agent)}…`, `Message à ${kindLabel(p.agent)}…`)
  return t('Command…')
})

// Enter: UChatPrompt only sends text; a photo alone, or an empty field
// while the agent is working (Stop), go through here.
function onKeydown(e: KeyboardEvent) {
  if (slashOpen.value && !e.isComposing) {
    const n = slashMatches.value.length
    if (e.key === 'ArrowDown') { e.preventDefault(); lastPointer = 'kb'; slashSel.value = (slashSel.value + 1) % n; return }
    if (e.key === 'ArrowUp') { e.preventDefault(); lastPointer = 'kb'; slashSel.value = (slashSel.value - 1 + n) % n; return }
    if (e.key === 'Escape') { e.preventDefault(); slashDismissed.value = true; return }
    if (e.key === 'Tab' || (enterSends.value && e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault()
      e.stopPropagation()
      pickSlash(slashMatches.value[slashSel.value] || slashMatches.value[0]!)
      return
    }
  }
  if (e.key === 'Tab' && !e.shiftKey && !e.isComposing && suggestion.value && !text.value) {
    e.preventDefault()
    useSuggestion()
    return
  }
  if (enterSends.value && e.key === 'Enter' && !e.shiftKey && !e.isComposing && !text.value.trim()) {
    e.preventDefault()
    submit()
  }
}
// The button handles Send and Stop itself (one click = one action, without
// going back through the form). In Stop mode ("streaming" status),
// UChatPromptSubmit replaces our @click with its "stop" event:
// @stop is what triggers the interruption.
function onSubmitClick(e: MouseEvent) {
  e.preventDefault()
  submit()
}
const hint = computed(() => desk.value && !stopMode.value)

async function submit() {
  if (readOnly.value) return toast(t('Sending unavailable offline'), true)
  if (stopMode.value) return interrupt()
  if (attachments.value.some(a => !a.path)) return toast(t(attachments.value.some(a => !a.path && a.file) ? 'File is uploading…' : 'Photo is uploading…'))
  // Photos and files go as file paths (`@<path>` for a text file given to
  // Claude): Claude Code and Codex open them themselves.
  const paths = attachments.value.map(a => a.ref || a.path!)
  const body = [text.value.trim(), ...paths].filter(Boolean).join('\n')
  // No marker before a "/" or "!" command: the agent would no longer read it as such
  // (a photo sent alone starts with its path: not a command).
  const reply = isSlashCommand(body) || body.startsWith('!') ? null : replyTo.value
  const msg = withReply(reply, body, language)
  if (!msg || sending.value) return
  const p = props.pane
  // omp question with "Other": the message is its free answer.
  const prompt = p && p.status === 'blocked' ? p.prompt : null
  const free = prompt ? prompt.options.findIndex(o => o.free) : -1
  // A message for the agent: its bubble at once, the field emptied, the send
  // after any earlier one still going (see composables/useOutbox.ts). Failed:
  // the bubble says "Not sent" with Retry / Cancel, nothing is lost.
  if (free < 0 && viaPrompt(p) && !isSlashCommand(msg)) {
    text.value = ''
    clearAttachments()
    if (reply) replyTo.value = null
    haptic()
    emit('sent', null)
    outboxSend(p, props.paneId, msg).then(() => emit('sent', null), (err: Error) => toast(err.message, true))
    return
  }
  sending.value = true
  try {
    let queued: QueuedMessage | null = null
    if (prompt && free >= 0) {
      if (!(await choose(props.paneId, free, prompt.options[free]!.label, { text: msg, question: prompt.question }))) return
    } else queued = await sendMessage(p, props.paneId, msg)
    text.value = ''
    clearAttachments()
    if (reply) replyTo.value = null
    haptic()
    emit('sent', queued)
    // "/" command: its result (terminal screen), as from the + menu.
    // A skill or custom command makes the agent reply: no panel.
    const cmd = msg.split(/\s/)[0]!
    const listed = slashCache.get(props.paneId)?.list || slashList.value
    if (free < 0 && p && p.agent && !paths.length && /^\/\S+$/.test(cmd) && !msg.includes('\n') && !isAgentCommand(cmd, listed)) {
      showCommandResult(props.paneId, cmd, listed.some(c => c.source === 'builtin' && `/${c.name}` === cmd))
    }
  } catch (err) {
    toast((err as Error).message, true)
  } finally {
    sending.value = false
  }
}

// ------------------------------------------------------------ Stop
// The server sends Escape, sends it again if the agent is still working, stops
// Claude's background tasks (see server/utils/interruptSeq.ts) then says whether the agent
// stopped. Otherwise: lasting message with access to the terminal.
const interrupting = ref<'running' | 'failed' | null>(null)
// What the last Stop targeted: the user's omp command, or the agent's turn.
const stoppingShell = ref(false)
async function interrupt() {
  if (interrupting.value === 'running') return
  haptic()
  interrupting.value = 'running'
  stoppingShell.value = shellRun.value
  try {
    const r = await api<{ stopped: boolean, background: number, shell?: boolean, restored?: string, lost?: number }>('/api/interrupt', { pane_id: props.paneId, restore: Boolean(props.takeBack) })
    interrupting.value = r.stopped ? null : 'failed'
    stoppingShell.value = Boolean(r.shell)
    if (r.shell) {
      if (r.stopped) toast(tl('Command cancelled', 'Commande annulée'))
      return
    }
    // Stopped before any reply: like Claude, the message comes back into the field.
    if (r.restored !== undefined) {
      restoreDraft(draft, r.restored)
      focusEnd()
      const back = tl('Stopped: your message is back in the field', 'Arrêté : ton message est revenu dans le champ')
      if (r.lost) toast(back, true, lostPhotosText(r.lost))
      else toast(back)
    } else if (r.stopped) toast(r.background ? tl(`Agent stopped (${r.background} background task${r.background > 1 ? 's' : ''} stopped)`, `Agent arrêté (${r.background} tâche${r.background > 1 ? 's' : ''} de fond arrêtée${r.background > 1 ? 's' : ''})`) : t('Agent stopped'))
  } catch (err) {
    interrupting.value = null
    toast((err as Error).message, true)
  }
}
// The agent eventually stops (or the user acts in the terminal): the message goes away.
watch(() => props.pane?.status, s => { if (interrupting.value === 'failed' && !stoppingShell.value && s !== 'working') interrupting.value = null })
watch(shellRun, on => { if (interrupting.value === 'failed' && stoppingShell.value && !on) interrupting.value = null })
// Escape (composables/useShortcuts.ts): the Stop button, only while it is shown and
// clickable. The field blurs itself on Escape: it gets the focus back for what comes next.
function stop() {
  if (!props.escStops || !stopMode.value || sending.value || interrupting.value === 'running') return false
  interrupt()
  ta.value?.focus()
  return true
}

// ------------------------------------------------------------ photos
function clearAttachments() {
  for (const a of attachments.value) if (a.url) URL.revokeObjectURL(a.url)
  attachments.value = []
}
// Large preview (same viewer as the conversation), including while
// sending: the local URL (blob) is enough.
function viewAtt(a: Att) { lightboxSrc.value = a.url }
function removeAtt(i: number) {
  const [a] = attachments.value.splice(i, 1)
  if (a && a.url) URL.revokeObjectURL(a.url)
}
watch(() => attachments.value.length, () => nextTick(layout))
// Long text: keep the caret in view once the field reaches its max height.
watch(text, () => nextTick(() => {
  const el = ta.value
  if (!el || el.scrollHeight <= el.clientHeight || document.activeElement !== el) return
  if (el.selectionEnd >= el.value.length - 1) el.scrollTop = el.scrollHeight
}))

async function shrink(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    const g = c.getContext('2d')!
    // JPEG without transparency: white background, otherwise transparent areas
    // (PNG screenshots) turn black.
    g.fillStyle = '#fff'
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.86))
    if (blob) return blob
  } catch { /* unreadable image: sent as is */ }
  finally { URL.revokeObjectURL(url) }
  return file
}

async function addImages(files: File[]) {
  for (const f of files) {
    const a = reactive<Att>({ url: URL.createObjectURL(f), path: null })
    attachments.value.push(a)
    try {
      const blob = await shrink(f)
      const r = await fetch(`/api/upload?pane=${encodeURIComponent(props.paneId)}`, { method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(t(d.error || `HTTP ${r.status}`))
      a.path = d.path
      a.name = d.name
    } catch (err) {
      toast(`${t('Photo upload failed')} : ${(err as Error).message}`, true)
      attachments.value = attachments.value.filter(x => x !== a)
      URL.revokeObjectURL(a.url)
    }
  }
}
// Any file (drop, +, paste): images take the photo path, files the agent
// reads are attached, the others are refused with the reason.
async function addFiles(files: File[]) {
  const p = props.pane
  const { images, files: readable, refused } = await sortForAgent(files, p?.agent)
  if (refused.length) {
    const who = kindLabel(p?.agent)
    const names = refused.map(r => r.file.name).join(', ')
    const why = [...new Set(refused.map(r => refusalText(r.reason, who, r.kind)))]
    toast(tl(`Not attached: ${names}`, `Non joint : ${names}`), true, why.join(' · '))
  }
  if (images.length) addImages(images)
  for (const r of readable) uploadFile(r.file, r.kind)
  return images.length + readable.length
}
async function uploadFile(f: File, kind: AttachKind) {
  const a = reactive<Att>({ url: '', path: null, file: { label: f.name, size: f.size, kind } })
  attachments.value.push(a)
  try {
    const r = await fetch(`/api/attach?pane=${encodeURIComponent(props.paneId)}&name=${encodeURIComponent(f.name)}`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f,
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(t(d.error || `HTTP ${r.status}`))
    a.path = d.path
    a.name = d.name
    a.ref = d.ref
  } catch (err) {
    toast(`${f.name} : ${t('File upload failed')} — ${(err as Error).message}`, true)
    attachments.value = attachments.value.filter(x => x !== a)
  }
}
function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  addFiles(files)
}

// Paste an image: straight into the field (Mac, iPad, and iPhone when
// Safari offers it)…
function onPaste(e: ClipboardEvent) {
  const files = [...((e.clipboardData && e.clipboardData.items) || [])]
    .filter(i => i.kind === 'file')
    .map(i => i.getAsFile()).filter((f): f is File => Boolean(f))
  if (!files.length) return // text: normal paste
  e.preventDefault()
  addFiles(files)
  haptic()
}

// …or via the + menu, which reads the clipboard (Safari asks for a
// "Paste" confirmation).
async function pasteFromClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.read) return toast(t('Clipboard unavailable here — paste into the message field.'), true)
  try {
    const found: File[] = []
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find(x => x.startsWith('image/'))
      if (type) found.push(new File([await item.getType(type)], `presse-papiers.${type.split('/')[1]}`, { type }))
    }
    if (!found.length) return toast(t('No image in the clipboard'), true)
    addImages(found)
  } catch (err) {
    const e = err as Error
    toast(e.name === 'NotAllowedError' ? t('Paste denied') : `${t('Paste failed')} : ${e.message}`, true)
  }
}

// ------------------------------------------------------------ "/" commands
// "/" as the first character: the agent's commands, like the terminal's
// menu (built-in + the machine's skills and commands), filtered as you
// type. Tapping a command puts it in the field; Enter sends it.
const slashCache = new Map<string, { at: number, list: SlashCommand[] }>()
const slashList = ref<SlashCommand[]>([])
const slashSel = ref(0)
const slashDismissed = ref(false)
const slashListEl = ref<HTMLElement | null>(null)
const slashQuery = computed(() => {
  const m = /^\/(\S*)$/.exec(text.value)
  return props.pane && props.pane.agent && m ? m[1]!.toLowerCase() : null
})
async function loadSlash() {
  const key = props.paneId
  const hit = slashCache.get(key)
  if (hit && Date.now() - hit.at < 60000) { slashList.value = hit.list; return }
  try {
    const r = await api<{ commands: SlashCommand[] }>(`/api/commands?pane=${encodeURIComponent(key)}`)
    slashCache.set(key, { at: Date.now(), list: r.commands })
    if (key === props.paneId) slashList.value = r.commands
  } catch { /* no suggestions */ }
}
watch(slashQuery, (q, old) => {
  if (q === null) { slashDismissed.value = false; return }
  if (old === null || old === undefined) loadSlash()
  slashSel.value = 0
})
watch(() => props.paneId, () => { slashList.value = [] })
const slashMatches = computed(() => {
  const q = slashQuery.value
  if (q === null) return []
  const starts: SlashCommand[] = []
  const inName: SlashCommand[] = []
  const inDesc: SlashCommand[] = []
  for (const c of slashList.value) {
    const n = c.name.toLowerCase()
    if (n.startsWith(q)) starts.push(c)
    else if (n.includes(q)) inName.push(c)
    else if (q.length > 1 && c.desc.toLowerCase().includes(q)) inDesc.push(c)
  }
  return [...starts, ...inName, ...inDesc]
})
const slashOpen = computed(() => slashQuery.value !== null && !slashDismissed.value && slashMatches.value.length > 0
  && !(slashMatches.value.length === 1 && slashMatches.value[0]!.name.toLowerCase() === slashQuery.value))
// Hover: only if the mouse really moved. When the list scrolls with the
// keyboard under a still pointer, the browser also emits hovers, which
// would steal the selection.
let lastPointer = ''
function hoverSlash(e: MouseEvent, i: number) {
  const at = `${e.screenX},${e.screenY}`
  const kb = lastPointer === 'kb'
  if (at === lastPointer) return
  lastPointer = at
  // Right after an arrow: the first position seen is that of the still pointer.
  if (kb) return
  slashSel.value = i
}
function pickSlash(c: SlashCommand) {
  text.value = `/${c.name} `
  haptic()
  nextTick(() => ta.value?.focus())
}
watch(slashSel, i => nextTick(() => {
  const el = slashListEl.value?.children[i] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest' })
}))

// ------------------------------------------------------------ menu +
const SLASH: Record<string, [string, string][]> = {
  claude: [['/compact', 'Summarize context'], ['/clear', 'New conversation'], ['/context', 'Context usage'],
    ['/usage', 'Plan usage'], ['/model', 'Change model'], ['/review', 'Code review']],
  codex: [['/compact', 'Summarize context'], ['/new', 'New conversation'], ['/status', 'Session status'],
    ['/model', 'Change model'], ['/review', 'Code review'], ['/diff', 'View diff']],
  omp: [['/compact', 'Summarize context'], ['/new', 'New conversation'], ['/plan', 'Plan mode'],
    ['/model', 'Change model'], ['/fast', 'Priority service tier']],
}
// Images first, then interruption and the agent's commands.
function openPlus() {
  const p = props.pane
  if (!p) return
  const items: MenuItem[] = [
    { label: t('Photo or screenshot'), icon: 'i-lucide-image', run: () => fileInput.value?.click() },
    { label: p.agent === 'claude' ? t('File (PDF, text, code)') : t('File (text, code)'), icon: 'i-lucide-paperclip', run: () => anyFileInput.value?.click() },
    { label: t('Paste copied image'), icon: 'i-lucide-clipboard-paste', run: pasteFromClipboard },
  ]
  if (p.agent) {
    items.push({ kind: 'separator' })
    items.push({ kind: 'command', cmd: 'esc', desc: t('Interrupt agent'), run: () => props.sendKeys(['esc']) })
    for (const [cmd, desc] of SLASH[p.agent] || []) {
      items.push({ kind: 'command', cmd, desc: t(desc), run: () => runSlash(cmd) })
    }
    items.push({ kind: 'note', label: t('Commands that open a menu (model…) can then be controlled in the Terminal tab.') })
  }
  openMenu(items)
}
async function runSlash(cmd: string) {
  try {
    await api('/api/prompt', { pane_id: props.paneId, text: cmd })
    haptic()
  } catch (err) { return toast((err as Error).message, true) }
  showCommandResult(props.paneId, cmd)
}

// Focus, cursor at the end (text set from outside: "Problem" of the Project
// panel). The focus is given right away, within the gesture, so that the iPhone
// opens the keyboard; the cursor is placed once the text is rendered.
function focusEnd() {
  if (tokensMode.value) {
    if (tokensRef.value) tokensRef.value.focusEnd()
    else nextTick(() => tokensRef.value?.focusEnd())
    return
  }
  ta.value?.focus()
  nextTick(() => {
    // A quote just added: the rich field may have taken over.
    if (tokensMode.value) return tokensRef.value?.focusEnd()
    const el = ta.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollTop = el.scrollHeight
  })
}

defineExpose({
  focus: () => (tokensMode.value ? tokensRef.value?.focus() : ta.value?.focus()),
  focusEnd,
  blur: () => (tokensMode.value ? tokensRef.value?.blur() : ta.value?.blur()),
  addImages, addFiles, stop,
})
</script>

<template>
  <div class="composer" :data-agent="pane?.agent || undefined">
    <div v-if="interrupting" class="composer-notice restart" :class="{ failed: interrupting === 'failed' }" role="status">
      <template v-if="interrupting === 'failed'">
        <span class="restart-text">{{ stoppingShell ? tl('The command is still running.', 'La commande tourne encore.') : t('The agent is still working.') }}</span>
        <button type="button" class="notice-btn" @click="emit('showTerminal')">{{ t('View terminal') }}</button>
        <button type="button" class="notice-btn" @click="interrupting = null">{{ t('Hide') }}</button>
      </template>
      <template v-else>
        <span class="notice-spin" aria-hidden="true" />
        <span class="restart-text">{{ stoppingShell ? tl('Cancelling the command…', 'Annulation de la commande…') : t('Stopping…') }}</span>
      </template>
    </div>
    <div v-else-if="pane?.restart" class="composer-notice restart" :class="pane.restart.phase" role="status">
      <template v-if="pane.restart.phase === 'failed'">
        <span class="restart-text">{{ pane.restart.update ? t('Codex update failed') : t('Restart failed') }}{{ tl(': ', ' : ') }}{{ t(pane.restart.error || '') }}</span>
        <button type="button" class="notice-btn" @click="emit('showTerminal')">{{ t('View terminal') }}</button>
        <button v-if="pane.restart.update" type="button" class="notice-btn" @click="copyUpdate"><UIcon name="i-lucide-copy" />{{ t('Copy command') }}</button>
        <button type="button" class="notice-btn" @click="dismissRestart(paneId)">{{ t('Hide') }}</button>
      </template>
      <template v-else>
        <span class="notice-spin" aria-hidden="true" />
        <span class="restart-text">{{ restartLabel }}</span>
      </template>
    </div>
    <div v-else-if="pane?.claudeNotice" class="composer-notice" :class="{ error: noticeIsError }" role="status">
      <template v-if="updateReady">
        <span class="restart-text">{{ pane.claudeNotice.replace(/\s*·\s*Restart to update\b.*$/, '') }} ·</span>
        <button type="button" class="notice-btn" :disabled="readOnly" @click="restartAgent(pane)">
          <UIcon name="i-lucide-rotate-cw" />{{ t('Restart to update') }}
        </button>
      </template>
      <template v-else>{{ noticeIsError && !/^[✗✘]/.test(pane.claudeNotice) ? `✘ ${pane.claudeNotice}` : pane.claudeNotice }}</template>
    </div>
    <CodexNotices v-else-if="pane?.codexStatus" :pane="pane" :pane-id="paneId" :read-only="readOnly" />
    <button
      v-if="suggestion && !enterSends" type="button" class="composer-suggest" @mousedown.prevent @click="useSuggestion"
    >
      <UIcon name="i-lucide-corner-down-left" /> {{ t('Use suggestion') }}
    </button>
    <div v-if="slashOpen" class="slash-menu" role="listbox" :aria-label="t('Commands')">
      <div ref="slashListEl" class="slash-list">
        <button
          v-for="(c, i) in slashMatches" :key="c.name" type="button" role="option" class="slash-item"
          :class="{ on: i === slashSel }" :aria-selected="i === slashSel"
          @mousedown.prevent @mousemove="hoverSlash($event, i)" @click="pickSlash(c)"
        >
          <span class="slash-name">/{{ c.name }}<small v-if="c.hint"> {{ c.hint }}</small></span>
          <span class="slash-desc">{{ c.desc }}</span>
        </button>
      </div>
    </div>
    <div v-if="replyTo" class="composer-reply" role="status">
      <UIcon name="i-lucide-reply" class="composer-reply-icon" />
      <span class="composer-reply-label">{{ t('Replying to the message') }} · {{ replyTo.time }}</span>
      <span class="composer-reply-text">{{ replyTo.excerpt }}</span>
      <button type="button" class="composer-reply-x" :aria-label="t('Cancel reply')" @mousedown.prevent @click="replyTo = null">
        <UIcon name="i-lucide-x" />
      </button>
    </div>
    <div v-if="quotes.length && !tokensMode" class="composer-quotes" role="list" :aria-label="t('Quoted questions')">
      <span class="composer-quotes-label">↳ {{ quotes.length }}</span>
      <span v-for="q in quotes" :key="q.start" class="composer-quote" role="listitem">
        <span class="composer-quote-text">{{ q.text }}</span>
        <button type="button" class="composer-quote-x" :aria-label="t('Remove quote')" @mousedown.prevent @click="text = removeQuote(text, q)">
          <UIcon name="i-lucide-x" />
        </button>
      </span>
    </div>
    <UChatPrompt
      ref="promptRef" v-model="text" :placeholder="readOnly ? t('Draft saved — sending unavailable offline') : placeholder" variant="outline" color="neutral"
      :rows="1" :maxrows="7" :autofocus="false" :submit-on-enter="enterSends && !slashOpen"
      :enterkeyhint="enterSends ? 'send' : 'enter'" autocapitalize="sentences"
      class="prompt" :ui="{ header: 'prompt-head', body: 'prompt-body', base: 'prompt-input', footer: 'prompt-foot' }"
      @submit="submit" @keydown="onKeydown" @paste="onPaste" @focus="taFocused = true" @blur="taFocused = false"
    >
      <template v-if="tokensMode" #body>
        <QuoteTokensField ref="tokensRef" v-model="text" :placeholder="placeholder" :enter-sends="enterSends" @submit="submit" @files="addFiles" />
      </template>
      <template v-if="attachments.length" #header>
        <div class="attachments">
          <template v-for="(a, i) in attachments" :key="a.url || a.path || a.file?.label">
            <FileChip
              v-if="a.file" :name="a.file.label" :size="a.file.size" :kind="a.file.kind" :uploading="!a.path" removable
              @remove="removeAtt(i)"
            />
            <div
              v-else class="att" :class="{ up: !a.path }"
              role="button" tabindex="0" :aria-label="t('View image')" @click="viewAtt(a)" @keydown.enter.self="viewAtt(a)"
            >
              <img :src="a.url" alt="">
              <span v-if="!a.path" class="spinner" />
              <button type="button" :aria-label="t('Remove')" @click.stop="removeAtt(i)"><UIcon name="i-lucide-x" /></button>
            </div>
          </template>
        </div>
      </template>
      <template #footer>
        <UButton
          icon="i-lucide-plus" color="neutral" variant="outline" size="sm" class="prompt-plus" :disabled="readOnly"
          :aria-label="t('Photo, file, paste, commands')" @click="openPlus"
        />
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles">
        <input ref="anyFileInput" type="file" multiple hidden data-testid="attach-any" @change="onFiles">
        <ModelPicker v-if="pane && (pane.agent === 'claude' || pane.agent === 'codex' || pane.agent === 'omp')" :pane="pane" />
        <span v-if="hint && suggestion" class="prompt-hint"><UKbd value="tab" size="sm" /> {{ t('suggestion') }} <span class="sep">·</span> <UKbd value="enter" size="sm" /> {{ t('send') }}</span>
        <span v-else-if="hint" class="prompt-hint"><UKbd value="enter" size="sm" /> {{ t('send') }} <span class="sep">·</span> <UKbd value="shift" size="sm" /><UKbd value="enter" size="sm" /> {{ t('new line') }}</span>
        <span v-else-if="desk && escStops && stopMode && interrupting !== 'running'" class="prompt-hint"><UKbd value="escape" size="sm" /> {{ tl('stop', 'arrêter') }}</span>
        <UChatPromptSubmit
          :status="stopMode ? 'streaming' : 'ready'" :disabled="readOnly || (!canSend && !stopMode) || sending || interrupting === 'running'"
          color="primary" variant="solid" streaming-color="neutral" streaming-variant="solid" streaming-icon="i-herdr-stop" size="sm"
          class="prompt-send" :class="{ stop: stopMode }" :aria-label="stopMode && shellRun ? tl('Cancel the command', 'Annuler la commande') : t(stopMode ? 'Stop the agent' : 'Send')"
          @mousedown.prevent @click="onSubmitClick" @stop="interrupt"
        />
      </template>
    </UChatPrompt>
    <!-- omp: its status line, as at the bottom of the terminal. -->
    <div v-if="pane?.ompStatus" class="composer-status" :title="[pane.ompStatus.line, pane.ompStatus.meters].filter(Boolean).join('\n')">
      <span class="composer-status-line">{{ pane.ompStatus.line }}</span>
      <span v-if="pane.ompStatus.meters" class="composer-status-meters">{{ pane.ompStatus.meters }}</span>
    </div>
  </div>
</template>
