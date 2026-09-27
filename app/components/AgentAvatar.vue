<script setup lang="ts">
// Logo de l'agent : étoile de Claude, logo OpenAI pour Codex, >_ pour un terminal.
defineProps<{ agent: string | null | undefined }>()
</script>

<template>
  <div v-if="!agent" class="avatar shell">&gt;_</div>
  <div v-else-if="agent === 'claude'" class="avatar claude"><UIcon name="i-herdr-claude-code" /></div>
  <div v-else-if="agent === 'codex'" class="avatar codex"><UIcon name="i-herdr-codex" /></div>
  <div v-else-if="agent === 'gemini'" class="avatar gemini"><UIcon name="i-lucide-sparkles" /></div>
  <div v-else-if="agent === 'opencode'" class="avatar opencode"><UIcon name="i-lucide-code-xml" /></div>
  <div v-else-if="agent === 'kimi'" class="avatar kimi"><UIcon name="i-lucide-moon-star" /></div>
  <div v-else class="avatar">{{ agent[0]!.toUpperCase() }}</div>
</template>
