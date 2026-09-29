<script setup lang="ts">
// Barre de saisie (UChatPrompt) : champ au-dessus, + · modèle et envoi dessous,
// comme Claude.ai. Agent au travail et champ vide : l'envoi devient « Stop » (Échap),
// via UChatPromptSubmit (état « streaming »).
// Photos réduites dans le navigateur (2048 px, JPEG) puis déposées sur le serveur ;
// leur chemin part avec le message.
import type { Pane, QueuedMessage, SlashCommand } from '#shared/types'
import type { DraftAtt } from '~/composables/useDraft'

const props = defineProps<{ pane: Pane | undefined, paneId: string, sendKeys: (keys: string[]) => Promise<void> }>()
const emit = defineEmits<{ sent: [queued: QueuedMessage | null] }>()

// Brouillon de la conversation (texte + photos), gardé en changeant de conversation.
const draft = useDraft(props.paneId)
const text = toRef(draft, 'text')
const promptRef = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null)
const ta = computed(() => promptRef.value?.textareaRef || null)
const fileInput = ref<HTMLInputElement | null>(null)
const sending = ref(false)
// Sur un clavier tactile, Entrée ajoute une ligne ; le bouton sous le champ envoie.
const touchKeyboard = import.meta.client && matchMedia('(pointer: coarse)').matches
const enterSends = computed(() => desk.value && !isIOS && !touchKeyboard)

type Att = DraftAtt
const attachments = toRef(draft, 'atts')

const canSend = computed(() => Boolean(text.value.trim() || attachments.value.length))
const readOnly = computed(() => !eventsOpen.value || offlineView.value || paneStale(props.pane))
// Hors ligne, pas de Stop : UChatPromptSubmit ignore `disabled` en mode « streaming ».
const stopMode = computed(() => Boolean(!readOnly.value && props.pane && props.pane.agent && props.pane.status === 'working' && !canSend.value))
// Suggestion grisée de Claude Code (cf. parseClaudeSuggestion) : placeholder du
// champ vide ; Tab (ou la puce, sur un écran tactile) la met dans le champ, sans l'envoyer.
const suggestion = computed(() => (!readOnly.value && !canSend.value && props.pane?.claudeSuggestion) || null)
function useSuggestion() {
  const s = suggestion.value
  if (!s) return
  text.value = s
  focusEnd()
}
const placeholder = computed(() => {
  const p = props.pane
  if (!p) return t('Message à l’agent…')
  if (p.status === 'blocked') return t('Réponse libre…')
  if (suggestion.value) return suggestion.value
  if (p.agent) return tl(`Message à ${kindLabel(p.agent)}…`, `Message to ${kindLabel(p.agent)}…`)
  return t('Commande…')
})

// Entrée : UChatPrompt n'envoie que du texte ; photo seule, ou champ vide
// pendant que l'agent travaille (Stop), passent par ici.
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
// Le bouton gère lui-même Envoyer et Stop (un clic = une action, sans
// repasser par le formulaire).
function onSubmitClick(e: MouseEvent) {
  e.preventDefault()
  submit()
}
const hint = computed(() => desk.value && !stopMode.value)

async function submit() {
  if (readOnly.value) return toast(t('Envoi indisponible hors ligne'), true)
  if (stopMode.value) {
    haptic()
    await props.sendKeys(['esc'])
    return toast(t('Interruption envoyée'))
  }
  if (attachments.value.some(a => !a.path)) return toast(t('Photo en cours d’envoi…'))
  // Les photos partent comme des chemins de fichiers : Claude Code et Codex
  // les ouvrent eux-mêmes.
  const paths = attachments.value.map(a => a.path!)
  const msg = [text.value.trim(), ...paths].filter(Boolean).join('\n')
  if (!msg || sending.value) return
  const p = props.pane
  sending.value = true
  try {
    const queued = await sendMessage(p, props.paneId, msg)
    text.value = ''
    clearAttachments()
    haptic()
    emit('sent', queued)
    // Commande « / » : son résultat (écran du terminal), comme depuis le menu +.
    if (p && p.agent && !paths.length && /^\/\S+$/.test(msg.split(/\s/)[0]!) && !msg.includes('\n')) showCommandResult(props.paneId, msg.split(/\s/)[0]!)
  } catch (err) {
    toast((err as Error).message, true)
  } finally {
    sending.value = false
  }
}

// ------------------------------------------------------------ photos
function clearAttachments() {
  for (const a of attachments.value) URL.revokeObjectURL(a.url)
  attachments.value = []
}
// Aperçu en grand (même visionneuse que la conversation), y compris pendant
// l'envoi : l'URL locale (blob) suffit.
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
    // JPEG sans transparence : fond blanc, sinon les zones transparentes
    // (captures d'écran PNG) deviennent noires.
    g.fillStyle = '#fff'
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.86))
    if (blob) return blob
  } catch { /* image illisible : envoyée telle quelle */ }
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
      toast(`${t('Photo non envoyée')} : ${(err as Error).message}`, true)
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

// Coller une image : directement dans le champ (Mac, iPad, et iPhone quand
// Safari la propose)…
function onPaste(e: ClipboardEvent) {
  const files = [...((e.clipboardData && e.clipboardData.items) || [])]
    .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    .map(i => i.getAsFile()).filter((f): f is File => Boolean(f))
  if (!files.length) return // du texte : collage normal
  e.preventDefault()
  addImages(files)
  haptic()
}

// …ou via le menu +, qui lit le presse-papiers (Safari demande une
// confirmation « Coller »).
async function pasteFromClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.read) return toast(t('Presse-papiers inaccessible ici — colle dans le champ de message.'), true)
  try {
    const found: File[] = []
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find(x => x.startsWith('image/'))
      if (type) found.push(new File([await item.getType(type)], `presse-papiers.${type.split('/')[1]}`, { type }))
    }
    if (!found.length) return toast(t('Pas d’image dans le presse-papiers'), true)
    addImages(found)
  } catch (err) {
    const e = err as Error
    toast(e.name === 'NotAllowedError' ? t('Collage refusé') : `${t('Collage impossible')} : ${e.message}`, true)
  }
}

// ------------------------------------------------------------ commandes « / »
// « / » en premier caractère : les commandes de l'agent, comme le menu du
// terminal (intégrées + skills et commandes de la machine), filtrées au fil de
// la frappe. Toucher une commande la place dans le champ ; Entrée l'envoie.
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
  } catch { /* pas de suggestions */ }
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
// Survol : seulement si la souris a vraiment bougé. Quand la liste défile au
// clavier sous un pointeur immobile, le navigateur émet aussi des survols, qui
// voleraient la sélection.
let lastPointer = ''
function hoverSlash(e: MouseEvent, i: number) {
  const at = `${e.screenX},${e.screenY}`
  const kb = lastPointer === 'kb'
  if (at === lastPointer) return
  lastPointer = at
  // Juste après une flèche : la première position vue est celle du pointeur immobile.
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
  claude: [['/compact', 'Résumer le contexte'], ['/clear', 'Nouvelle conversation'], ['/context', 'Occupation du contexte'],
    ['/usage', 'Consommation du forfait'], ['/model', 'Changer de modèle'], ['/review', 'Revue de code']],
  codex: [['/compact', 'Résumer le contexte'], ['/new', 'Nouvelle conversation'], ['/status', 'État de la session'],
    ['/model', 'Changer de modèle'], ['/review', 'Revue de code'], ['/diff', 'Voir le diff']],
}
// Images d'abord, puis interruption et commandes de l'agent.
function openPlus() {
  const p = props.pane
  if (!p) return
  const items: MenuItem[] = [
    { label: t('Photo ou capture d’écran'), icon: 'i-lucide-image', run: () => fileInput.value?.click() },
    { label: t('Coller l’image copiée'), icon: 'i-lucide-clipboard-paste', run: pasteFromClipboard },
  ]
  if (p.agent) {
    items.push({ kind: 'separator' })
    items.push({ kind: 'command', cmd: 'esc', desc: t('Interrompre l’agent'), run: () => props.sendKeys(['esc']) })
    for (const [cmd, desc] of SLASH[p.agent] || []) {
      items.push({ kind: 'command', cmd, desc: t(desc), run: () => runSlash(cmd) })
    }
    items.push({ kind: 'note', label: t('Les commandes qui ouvrent un menu (modèle…) se pilotent ensuite dans l’onglet Terminal.') })
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

// Focus, curseur à la fin (texte posé de l'extérieur : « Problème » du panneau
// Projet). Le focus est donné tout de suite, dans le geste, pour que l'iPhone
// ouvre le clavier ; le curseur est placé une fois le texte rendu.
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

defineExpose({ focus: () => ta.value?.focus(), focusEnd, blur: () => ta.value?.blur(), addImages })
</script>

<template>
  <div class="composer">
    <div v-if="pane?.claudeNotice" class="composer-notice" role="status">{{ pane.claudeNotice }}</div>
    <button
      v-if="suggestion && !enterSends" type="button" class="composer-suggest" @mousedown.prevent @click="useSuggestion"
    >
      <UIcon name="i-lucide-corner-down-left" /> {{ t('Utiliser la suggestion') }}
    </button>
    <div v-if="slashOpen" class="slash-menu" role="listbox" :aria-label="t('Commandes')">
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
    <UChatPrompt
      ref="promptRef" v-model="text" :placeholder="readOnly ? t('Brouillon conservé — envoi indisponible hors ligne') : placeholder" variant="outline" color="neutral"
      :rows="1" :maxrows="7" :autofocus="false" :submit-on-enter="enterSends && !slashOpen"
      :enterkeyhint="enterSends ? 'send' : 'enter'" autocapitalize="sentences"
      class="prompt" :ui="{ header: 'prompt-head', body: 'prompt-body', base: 'prompt-input', footer: 'prompt-foot' }"
      @submit="submit" @keydown="onKeydown" @paste="onPaste"
    >
      <template v-if="attachments.length" #header>
        <div class="attachments">
          <div
            v-for="(a, i) in attachments" :key="a.url" class="att" :class="{ up: !a.path }"
            role="button" tabindex="0" :aria-label="t('Voir l’image')" @click="viewAtt(a)" @keydown.enter.self="viewAtt(a)"
          >
            <img :src="a.url" alt="">
            <span v-if="!a.path" class="spinner" />
            <button type="button" :aria-label="t('Retirer')" @click.stop="removeAtt(i)"><UIcon name="i-lucide-x" /></button>
          </div>
        </div>
      </template>
      <template #footer>
        <UButton
          icon="i-lucide-plus" color="neutral" variant="outline" size="sm" class="prompt-plus" :disabled="readOnly"
          :aria-label="t('Photo, collage, commandes')" @click="openPlus"
        />
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles">
        <ModelPicker v-if="pane && hasChat(pane)" :pane="pane" />
        <span v-if="hint && suggestion" class="prompt-hint"><UKbd value="tab" size="sm" /> {{ t('suggestion') }} <span class="sep">·</span> <UKbd value="enter" size="sm" /> {{ t('envoyer') }}</span>
        <span v-else-if="hint" class="prompt-hint"><UKbd value="enter" size="sm" /> {{ t('envoyer') }} <span class="sep">·</span> <UKbd value="shift" size="sm" /><UKbd value="enter" size="sm" /> {{ t('nouvelle ligne') }}</span>
        <UChatPromptSubmit
          :status="stopMode ? 'streaming' : 'ready'" :disabled="readOnly || (!canSend && !stopMode) || sending"
          color="primary" variant="solid" streaming-color="neutral" streaming-variant="solid" streaming-icon="i-herdr-stop" size="sm"
          class="prompt-send" :class="{ stop: stopMode }" :aria-label="t(stopMode ? 'Arrêter l’agent' : 'Envoyer')"
          @mousedown.prevent @click="onSubmitClick"
        />
      </template>
    </UChatPrompt>
  </div>
</template>
