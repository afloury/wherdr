<script setup lang="ts">
// Message field with the quotes as tokens (utils/quoteTokens.ts), used by the
// Composer while the draft holds a quote and the setting is on. The model is
// the draft text ("> " lines + answers): the field is drawn from it and read
// back into it on every input. Only plain text gets in: paste and drop insert
// text/plain, formatting commands are refused. Typing, Enter / Shift+Enter,
// paste and token deletion go through the browser's editing, so undo / redo
// keeps working.
import { enterAction, fieldItems, readField, type FieldNode } from '~/utils/quoteTokens'
import { isLongPaste } from '#shared/pastedText'

const text = defineModel<string>({ required: true })
const props = defineProps<{ placeholder?: string, enterSends: boolean }>()
const emit = defineEmits<{ submit: [], files: [files: File[]], pasted: [text: string] }>()
const el = ref<HTMLElement | null>(null)
// Last text read from or drawn into the field: an outside change (a quote
// added, the message sent, a draft restored) redraws it.
let last = ''

const tokenText = (n: FieldNode) => {
  const e = n as unknown as HTMLElement
  return e.classList?.contains('rb-token') ? e.dataset.q ?? '' : null
}

function token(quote: string) {
  const tok = document.createElement('span')
  tok.className = 'rb-token'
  tok.contentEditable = 'false'
  tok.dataset.q = quote
  tok.title = quote
  const label = document.createElement('span')
  label.className = 'rb-token-label'
  label.textContent = '↳'
  const body = document.createElement('span')
  body.className = 'rb-token-text'
  body.textContent = quote.replace(/\n/g, ' ')
  const x = document.createElement('button')
  x.type = 'button'
  x.tabIndex = -1
  x.className = 'rb-token-x'
  x.setAttribute('aria-label', t('Remove quote'))
  x.textContent = '✕'
  tok.append(label, body, x)
  return tok
}

function build(value: string) {
  const root = el.value
  if (!root) return
  root.textContent = ''
  const items = fieldItems(value)
  for (const it of items) {
    if (it.kind === 'token') { root.append(token(it.text)); continue }
    const line = document.createElement('div')
    if (it.text) line.textContent = it.text
    else line.append(document.createElement('br'))
    root.append(line)
  }
  // Always a line after a last token, for the caret.
  if (items.at(-1)?.kind === 'token') {
    const line = document.createElement('div')
    line.append(document.createElement('br'))
    root.append(line)
  }
}

function read() {
  if (!el.value) return
  last = readField(el.value as unknown as FieldNode, tokenText)
  text.value = last
}

function caretEnd() {
  const root = el.value
  if (!root) return
  root.focus({ preventScroll: true })
  const r = document.createRange()
  r.selectNodeContents(root.lastChild || root)
  r.collapse(false)
  const s = window.getSelection()
  s?.removeAllRanges()
  s?.addRange(r)
  root.scrollTop = root.scrollHeight
}

// Plain text at the caret, as one undoable edit.
function insertPlain(s: string) {
  if (!s) return
  if (!document.execCommand('insertText', false, s)) {
    const sel = window.getSelection()
    const r = sel?.rangeCount ? sel.getRangeAt(0) : null
    if (!r) return
    r.deleteContents()
    r.insertNode(document.createTextNode(s))
    r.collapse(false)
    read()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (enterAction(e, props.enterSends) === 'send') {
    e.preventDefault()
    emit('submit')
    return
  }
  // No bold / italic / underline: the field is plain text.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[biu]$/i.test(e.key)) e.preventDefault()
}
function onBeforeInput(e: InputEvent) {
  if (e.inputType.startsWith('format')) e.preventDefault()
}
function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => Boolean(f))
  if (files.length) { emit('files', files); return }
  const s = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n')
  // Long text: a "Pasted text" card in the field (see shared/pastedText.ts).
  if (isLongPaste(s)) { emit('pasted', s); return }
  insertPlain(s)
}
// Files dropped: the agent view takes them (attachments). Text: plain only.
function onDrop(e: DragEvent) {
  const dt = e.dataTransfer
  if (!dt || [...dt.types].includes('Files')) return
  e.preventDefault()
  const s = dt.getData('text/plain')
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node, offset: number } | null }
  let r: Range | null = null
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(e.clientX, e.clientY)
    if (pos) {
      r = document.createRange()
      r.setStart(pos.offsetNode, pos.offset)
    }
  } else r = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null
  el.value?.focus()
  if (r && el.value?.contains(r.startContainer)) {
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
  }
  insertPlain(s)
}
// ✕ of a token: deleted like a selection (undoable); its answer stays. Its
// mousedown keeps the caret where it is.
const onMouseDown = (e: MouseEvent) => { if ((e.target as HTMLElement).closest?.('.rb-token-x')) e.preventDefault() }
function onClick(e: MouseEvent) {
  const x = (e.target as HTMLElement).closest?.('.rb-token-x')
  const tok = x?.closest('.rb-token')
  if (!tok || !el.value) return
  e.preventDefault()
  el.value.focus({ preventScroll: true })
  const r = document.createRange()
  r.selectNode(tok)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(r)
  // Some browsers refuse to delete a non-editable node this way: removed directly then.
  document.execCommand('delete')
  if (tok.isConnected) tok.remove()
  read()
}

watch(text, (v) => {
  if (v === last) return
  last = v
  const focused = document.activeElement === el.value
  build(v)
  if (focused) nextTick(caretEnd)
})
onMounted(() => {
  last = text.value
  build(text.value)
})

defineExpose({
  focus: () => el.value?.focus(),
  focusEnd: caretEnd,
  blur: () => el.value?.blur(),
})
</script>

<template>
  <div
    ref="el" class="rb-field" contenteditable="true" role="textbox" aria-multiline="true" :aria-label="placeholder"
    autocapitalize="sentences" :enterkeyhint="enterSends ? 'send' : 'enter'" :data-placeholder="placeholder"
    @input="read" @keydown="onKeydown" @beforeinput="onBeforeInput" @paste="onPaste" @drop="onDrop" @mousedown="onMouseDown" @click="onClick"
  />
</template>
