<script setup lang="ts">
// TEMPORARY (t-0199, concept b): one field where each quote is a compact,
// non-editable token (like a mention), the answer written below it. The
// model is the same text as today ("> " lines, utils/questionReply.ts):
// tokens are drawn from it and the field is written back to it.
const text = defineModel<string>({ required: true })
defineProps<{ placeholder?: string }>()
const el = ref<HTMLElement | null>(null)
let last = ''

function build(value: string) {
  const root = el.value
  if (!root) return
  root.textContent = ''
  const lines = value.split('\n')
  let i = 0
  while (i < lines.length) {
    const m = /^>\s?(.*)$/.exec(lines[i]!)
    if (m) {
      const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ''))
      const tok = document.createElement('span')
      tok.className = 'rb-token'
      tok.contentEditable = 'false'
      tok.dataset.q = q.join('\n')
      const label = document.createElement('span')
      label.className = 'rb-token-label'
      label.textContent = '↳'
      const body = document.createElement('span')
      body.className = 'rb-token-text'
      body.textContent = q.join(' ')
      const x = document.createElement('button')
      x.type = 'button'
      x.className = 'rb-token-x'
      x.setAttribute('aria-label', t('Remove quote'))
      x.textContent = '✕'
      tok.append(label, body, x)
      root.append(tok)
      continue
    }
    const line = document.createElement('div')
    if (lines[i]) line.textContent = lines[i]!
    else line.append(document.createElement('br'))
    root.append(line)
    i++
  }
  // Always a line after the last token, for the caret.
  if (root.lastElementChild?.classList.contains('rb-token')) root.append(Object.assign(document.createElement('div'), { innerHTML: '<br>' }))
}

function serialize(): string {
  const out: string[] = []
  for (const n of el.value?.childNodes || []) {
    if (n.nodeType === 3) { out.push(n.textContent || ''); continue }
    const e = n as HTMLElement
    if (e.classList?.contains('rb-token')) out.push(...(e.dataset.q || '').split('\n').map(l => `> ${l}`))
    else if (e.tagName === 'BR') out.push('')
    else out.push(e.textContent || '')
  }
  return out.join('\n').replace(/\n+$/, '\n')
}

function caretEnd() {
  const root = el.value
  if (!root) return
  root.focus()
  const r = document.createRange()
  r.selectNodeContents(root.lastChild || root)
  r.collapse(false)
  const s = window.getSelection()
  s?.removeAllRanges()
  s?.addRange(r)
}

function onInput() {
  last = serialize()
  text.value = last
}
function onClick(e: MouseEvent) {
  const x = (e.target as HTMLElement).closest?.('.rb-token-x')
  if (!x) return
  e.preventDefault()
  x.closest('.rb-token')?.remove()
  onInput()
}

watch(text, v => {
  if (v === last) return
  last = v
  build(v)
  nextTick(caretEnd)
})
onMounted(() => {
  last = text.value
  build(text.value)
  caretEnd()
})
</script>

<template>
  <div
    ref="el" class="rb-field" contenteditable="true" role="textbox" aria-multiline="true" :aria-label="placeholder"
    autocapitalize="sentences" :data-placeholder="placeholder" @input="onInput" @click="onClick"
  />
</template>
