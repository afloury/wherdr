<script setup lang="ts">
// Input bar (UChatPrompt): field on top, + · model and send below,
// like Claude.ai. Agent working and field empty: send becomes "Stop" (Escape),
// via UChatPromptSubmit ("streaming" state).
// Photos shrunk in the browser (2048 px, JPEG) then stored on the server;
// their path goes with the message.
import type { Pane, QueuedMessage, SlashCommand } from '#shared/types'
import type { DraftAtt } from '~/composables/useDraft'
import { withReply } from '#shared/replyQuote'
import { isAgentCommand } from '#shared/commandScreen'

// `escStops`: Escape is free for Stop (the conversation search, which closes on it, is shut).
const props = defineProps<{ pane: Pane | undefined, paneId: string, sendKeys: (keys: string[]) => Promise<void>, escStops?: boolean }>()
const emit = defineEmits<{ sent: [queued: QueuedMessage | null], showTerminal: [] }>()

// Claude Code update installed: the status line restarts the agent.
// Claude Code error status ("Auto-update failed…"): in red, like in the terminal.
const noticeIsError = computed(() => /\b(failed|error)\b/i.test(props.pane?.claudeNotice || ''))
const updateReady = computed(() => Boolean(props.pane?.claudeNotice && /Restart to update/i.test(props.pane.claudeNotice) && canRestart(props.pane)))
const restartLabel = computed(() => {
  const r = props.pane?.restart
  if (!r) return ''
  const who = kindLabel(r.agent)
  return r.phase === 'stopping' ? tl(`Stopping ${who}…`, `Arrêt de ${who}…`) : tl(`Restarting ${who} on the same conversation…`, `Relance de ${who} sur la même conversation…`)
})

// Conversation draft (text + photos), kept when switching conversations.
const draft = useDraft(props.paneId)
const text = toRef(draft, 'text')
const promptRef = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null)
const ta = computed(() => promptRef.value?.textareaRef || null)
const fileInput = ref<HTMLInputElement | null>(null)
const sending = ref(false)
// On a touch keyboard, Enter adds a line; the button below the field sends.
const enterSends = computed(() => desk.value && !isIOS && !touchKeyboard)

type Att = DraftAtt
const attachments = toRef(draft, 'atts')
// Reply to a specific agent message: box above the field, short marker on send.
const replyTo = toRef(draft, 'reply')

const canSend = computed(() => Boolean(text.value.trim() || attachments.value.length))
const readOnly = computed(() => !eventsOpen.value || offlineView.value || paneStale(props.pane))
// Offline, no Stop: UChatPromptSubmit ignores `disabled` in "streaming" mode.
const stopMode = computed(() => Boolean(!readOnly.value && props.pane && props.pane.agent && props.pane.status === 'working' && !canSend.value))
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
  if (attachments.value.some(a => !a.path)) return toast(t('Photo is uploading…'))
  // Photos go as file paths: Claude Code and Codex
  // open them themselves.
  const paths = attachments.value.map(a => a.path!)
  const body = [text.value.trim(), ...paths].filter(Boolean).join('\n')
  // No marker before a "/" or "!" command: the agent would no longer read it as such.
  const reply = /^[/!]/.test(body) ? null : replyTo.value
  const msg = withReply(reply, body, language)
  if (!msg || sending.value) return
  const p = props.pane
  sending.value = true
  try {
    // omp question with "Other": the message is its free answer.
    const prompt = p && p.status === 'blocked' ? p.prompt : null
    const free = prompt ? prompt.options.findIndex(o => o.free) : -1
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
async function interrupt() {
  if (interrupting.value === 'running') return
  haptic()
  interrupting.value = 'running'
  try {
    const r = await api<{ stopped: boolean, background: number }>('/api/interrupt', { pane_id: props.paneId })
    interrupting.value = r.stopped ? null : 'failed'
    if (r.stopped) toast(r.background ? tl(`Agent stopped (${r.background} background task${r.background > 1 ? 's' : ''} stopped)`, `Agent arrêté (${r.background} tâche${r.background > 1 ? 's' : ''} de fond arrêtée${r.background > 1 ? 's' : ''})`) : t('Agent stopped'))
  } catch (err) {
    interrupting.value = null
    toast((err as Error).message, true)
  }
}
// The agent eventually stops (or the user acts in the terminal): the message goes away.
watch(() => props.pane?.status, s => { if (interrupting.value === 'failed' && s !== 'working') interrupting.value = null })
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
  for (const a of attachments.value) URL.revokeObjectURL(a.url)
  attachments.value = []
}
// Large preview (same viewer as the conversation), including while
// sending: the local URL (blob) is enough.
function viewAtt(a: Att) { lightboxSrc.value = a.url }
function removeAtt(i: number) {
  const [a] = attachments.value.splice(i, 1)
  if (a) URL.revokeObjectURL(a.url)
}
watch(() => attachments.value.length, () => nextTick(layout))

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
function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  addImages(files)
}

// Paste an image: straight into the field (Mac, iPad, and iPhone when
// Safari offers it)…
function onPaste(e: ClipboardEvent) {
  const files = [...((e.clipboardData && e.clipboardData.items) || [])]
    .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    .map(i => i.getAsFile()).filter((f): f is File => Boolean(f))
  if (!files.length) return // du texte : collage normal
  e.preventDefault()
  addImages(files)
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
}
// Images first, then interruption and the agent's commands.
function openPlus() {
  const p = props.pane
  if (!p) return
  const items: MenuItem[] = [
    { label: t('Photo or screenshot'), icon: 'i-lucide-image', run: () => fileInput.value?.click() },
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
  ta.value?.focus()
  nextTick(() => {
    const el = ta.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollTop = el.scrollHeight
  })
}

defineExpose({ focus: () => ta.value?.focus(), focusEnd, blur: () => ta.value?.blur(), addImages, stop })
</script>

<template>
  <div class="composer">
    <div v-if="interrupting" class="composer-notice restart" :class="{ failed: interrupting === 'failed' }" role="status">
      <template v-if="interrupting === 'failed'">
        <span class="restart-text">{{ t('The agent is still working.') }}</span>
        <button type="button" class="notice-btn" @click="emit('showTerminal')">{{ t('View terminal') }}</button>
        <button type="button" class="notice-btn" @click="interrupting = null">{{ t('Hide') }}</button>
      </template>
      <template v-else>
        <span class="notice-spin" aria-hidden="true" />
        <span class="restart-text">{{ t('Stopping…') }}</span>
      </template>
    </div>
    <div v-else-if="pane?.restart" class="composer-notice restart" :class="pane.restart.phase" role="status">
      <template v-if="pane.restart.phase === 'failed'">
        <span class="restart-text">{{ t('Restart failed') }}{{ tl(': ', ' : ') }}{{ t(pane.restart.error || '') }}</span>
        <button type="button" class="notice-btn" @click="emit('showTerminal')">{{ t('View terminal') }}</button>
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
      <span class="composer-reply-label">{{ replyTo.part ? t('Replying to a passage') : t('Replying to the message') }} · {{ replyTo.time }}</span>
      <span class="composer-reply-text">{{ replyTo.excerpt }}</span>
      <button type="button" class="composer-reply-x" :aria-label="t('Cancel reply')" @mousedown.prevent @click="replyTo = null">
        <UIcon name="i-lucide-x" />
      </button>
    </div>
    <UChatPrompt
      ref="promptRef" v-model="text" :placeholder="readOnly ? t('Draft saved — sending unavailable offline') : placeholder" variant="outline" color="neutral"
      :rows="1" :maxrows="7" :autofocus="false" :submit-on-enter="enterSends && !slashOpen"
      :enterkeyhint="enterSends ? 'send' : 'enter'" autocapitalize="sentences"
      class="prompt" :ui="{ header: 'prompt-head', body: 'prompt-body', base: 'prompt-input', footer: 'prompt-foot' }"
      @submit="submit" @keydown="onKeydown" @paste="onPaste"
    >
      <template v-if="attachments.length" #header>
        <div class="attachments">
          <div
            v-for="(a, i) in attachments" :key="a.url" class="att" :class="{ up: !a.path }"
            role="button" tabindex="0" :aria-label="t('View image')" @click="viewAtt(a)" @keydown.enter.self="viewAtt(a)"
          >
            <img :src="a.url" alt="">
            <span v-if="!a.path" class="spinner" />
            <button type="button" :aria-label="t('Remove')" @click.stop="removeAtt(i)"><UIcon name="i-lucide-x" /></button>
          </div>
        </div>
      </template>
      <template #footer>
        <UButton
          icon="i-lucide-plus" color="neutral" variant="outline" size="sm" class="prompt-plus" :disabled="readOnly"
          :aria-label="t('Photo, paste, commands')" @click="openPlus"
        />
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles">
        <ModelPicker v-if="pane && (pane.agent === 'claude' || pane.agent === 'codex')" :pane="pane" />
        <span v-if="hint && suggestion" class="prompt-hint"><UKbd value="tab" size="sm" /> {{ t('suggestion') }} <span class="sep">·</span> <UKbd value="enter" size="sm" /> {{ t('send') }}</span>
        <span v-else-if="hint" class="prompt-hint"><UKbd value="enter" size="sm" /> {{ t('send') }} <span class="sep">·</span> <UKbd value="shift" size="sm" /><UKbd value="enter" size="sm" /> {{ t('new line') }}</span>
        <span v-else-if="desk && escStops && stopMode && interrupting !== 'running'" class="prompt-hint"><UKbd value="escape" size="sm" /> {{ tl('stop', 'arrêter') }}</span>
        <UChatPromptSubmit
          :status="stopMode ? 'streaming' : 'ready'" :disabled="readOnly || (!canSend && !stopMode) || sending || interrupting === 'running'"
          color="primary" variant="solid" streaming-color="neutral" streaming-variant="solid" streaming-icon="i-herdr-stop" size="sm"
          class="prompt-send" :class="{ stop: stopMode }" :aria-label="t(stopMode ? 'Stop the agent' : 'Send')"
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
