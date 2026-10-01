<script setup lang="ts">
// Home: on the phone, the list (in app.vue); on a computer, a
// prompt panel to the right of the list.
onMounted(() => { curPane.value = null })
</script>

<template>
  <section v-if="desk" id="placeholder" class="view placeholder hw-grid">
    <div class="empty-box">
      <div class="empty-art">&gt;_</div>
      <p>{{ t('Choisis un agent dans la liste') }}</p>
      <p class="muted">{{ t('ou lances-en un nouveau.') }}</p>
    </div>
  </section>
</template>
