<script setup lang="ts">
// Aperçu en direct de la machine à écrire (Réglages) : exemple de réponse
// déroulé par ChatMarkdown, comme dans la conversation. Rejoué à chaque
// changement de vitesse ou de texte chiffré, et par le bouton ↻.
import { previewStart, typingSample } from '~/utils/typingPreview'

const html = md(typingSample(language))
const typing = ref<number | null>(null)
const box = ref<HTMLElement | null>(null)
// Hauteur finale réservée (mesurée avant le premier déroulé, texte entier) :
// la carte ne grandit pas pendant l'écriture.
const height = ref('')
const replay = () => { typing.value = previewStart(typingSpeed.value, Date.now()) }
onMounted(() => {
  if (box.value) height.value = `${box.value.offsetHeight}px`
  replay()
})
watch([typingSpeed, encryptedActive], replay)
</script>

<template>
  <figure class="typing-preview">
    <figcaption>
      <span>{{ t('Aperçu') }}</span>
      <UTooltip :text="t('Rejouer')">
        <button type="button" class="typing-replay" :aria-label="t('Rejouer')" :disabled="!typewriterActive" @click="replay">
          <UIcon name="i-lucide-rotate-ccw" />
        </button>
      </UTooltip>
    </figcaption>
    <div ref="box" class="typing-sample md" :style="{ minHeight: height }">
      <ChatMarkdown :html="html" :typing="typing" @done="typing = null" />
    </div>
  </figure>
</template>
