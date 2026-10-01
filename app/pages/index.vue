<script setup lang="ts">
// Accueil : sur téléphone, la liste (dans app.vue) ; sur ordinateur, un
// panneau d'invite à droite de la liste.
onMounted(() => { curPane.value = null })
</script>

<template>
  <section v-if="desk" id="placeholder" class="view placeholder hw-grid">
    <div class="empty-box">
      <div class="empty-art">&gt;_</div>
      <p>{{ t('Choose an agent from the list') }}</p>
      <p class="muted">{{ t('or start a new one.') }}</p>
    </div>
  </section>
</template>
