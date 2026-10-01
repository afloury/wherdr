<script setup lang="ts">
// Home: on the phone, the list (in app.vue); on a computer, a
// prompt panel to the right of the list.
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
