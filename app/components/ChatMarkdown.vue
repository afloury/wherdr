<script setup lang="ts">
// Réponse de l'agent en markdown. `typing` = heure de départ du déroulé (effet
// machine à écrire, utils/typewriter.ts) : le HTML final est rendu tel quel
// puis ses nœuds texte sont révélés progressivement. Un toucher le termine ;
// `typing` qui repasse à null aussi (nouveau message, réglage coupé).
// En mode chiffré, l'écriture et le déchiffrement ont chacun leur front.
// La bande entre les deux traverse les nœuds Markdown sans réécrire le HTML.
import { applyReveal, cipherSegments, finishReveal, GLYPH_MS, planReveal, revealedAt, trailGlyphs, typeDuration, typingFronts } from '~/utils/typewriter'
import type { RevealNode, RevealPlan } from '~/utils/typewriter'

const props = defineProps<{ html: string, typing: number | null }>()
const emit = defineEmits<{ done: [] }>()
const el = ref<HTMLElement | null>(null)

let plan: RevealPlan | null = null
let raf = 0
const atomic = (n: RevealNode) => (n as unknown as Element).classList?.contains('code-head')
const keep = (n: RevealNode) => /^T[DH]$/.test((n as unknown as Element).tagName || '')

// Les boîtes ne changent qu'au déplacement d'un front. Les glyphes se
// renouvellent à cadence fixe, dans l'unique boucle requestAnimationFrame.
let bands: { box: HTMLElement, cells: HTMLElement[] }[] = []
let bandKey = ''
let glyphAt = 0
function dropBands() {
  for (const band of bands) band.box.remove()
  bands = []
  bandKey = ''
}
function drawBands(p: RevealPlan, decrypted: number, written: number, now: number) {
  const key = `${decrypted}:${written}`
  if (key !== bandKey) {
    dropBands()
    bandKey = key
    for (const segment of cipherSegments(p, decrypted, written)) {
      const text = segment.node as Text
      if (!text.parentNode) continue
      const box = document.createElement('span')
      box.className = 'tw-trail'
      box.setAttribute('aria-hidden', 'true')
      const cells: HTMLElement[] = []
      const glyphs = trailGlyphs(segment.text)
      Array.from(segment.text).forEach((c, i) => {
        if (/\s/.test(c)) return box.append(c)
        const cell = document.createElement('span')
        cell.textContent = c
        cell.setAttribute('data-g', glyphs[i]!)
        cells.push(cell)
        box.append(cell)
      })
      text.parentNode.insertBefore(box, text.nextSibling)
      bands.push({ box, cells })
    }
    bands.at(-1)?.cells.at(-1)?.classList.add('tw-front')
    glyphAt = now
  } else if (now - glyphAt >= GLYPH_MS) {
    glyphAt = now
    for (const band of bands) {
      const glyphs = trailGlyphs(band.cells.map(c => c.textContent || '').join(''))
      band.cells.forEach((c, i) => c.setAttribute('data-g', glyphs[i]!))
    }
  }
}

function stop() {
  cancelAnimationFrame(raf)
  raf = 0
  dropBands()
  if (plan) finishReveal(plan)
  plan = null
}
function start(at: number) {
  stop()
  if (!el.value) return
  plan = planReveal(el.value as unknown as RevealNode, { atomic, keep })
  const p = plan
  const duration = typeDuration(p.total, typingSpeed.value)
  const encrypted = encryptedActive.value
  const step = () => {
    if (plan !== p) return
    // Heure de départ fixe : un composant recréé (tranche chargée au-dessus)
    // reprend où il en était.
    const elapsed = Date.now() - at
    const fronts = encrypted ? typingFronts(p.total, elapsed, typingSpeed.value) : null
    const written = fronts?.written ?? revealedAt(p.stops, elapsed, duration)
    const decrypted = fronts?.decrypted ?? written
    applyReveal(p, decrypted, encrypted, written)
    if (encrypted) drawBands(p, decrypted, written, performance.now())
    if (fronts?.done || (!encrypted && elapsed >= duration)) {
      stop()
      emit('done')
    } else raf = requestAnimationFrame(step)
  }
  step()
}
function onClick() {
  if (plan) {
    stop()
    emit('done')
  }
}

// Premier état appliqué avant l'affichage : pas d'éclair du texte complet.
onMounted(() => { if (props.typing !== null) start(props.typing) })
watch(() => props.typing, (at) => {
  if (at === null) stop()
  else start(at)
})
// Texte remplacé (rare) : le nouveau HTML s'affiche en entier.
watch(() => props.html, () => {
  if (!plan) return
  cancelAnimationFrame(raf)
  dropBands()
  plan = null
  emit('done')
}, { flush: 'pre' })
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  dropBands()
  plan = null
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- HTML nettoyé par DOMPurify (utils/markdown.ts) -->
  <div ref="el" class="md-body" :class="{ typing: typing !== null }" @click.capture="onClick" v-html="html" />
</template>
