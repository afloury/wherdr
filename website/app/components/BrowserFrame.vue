<script setup lang="ts">
// A flat, 1 px browser window around a desktop screenshot.
defineProps<{ src: string, alt: string, url?: string, width?: number, height?: number, eager?: boolean }>()
</script>

<template>
  <figure class="bf">
    <div class="bar" aria-hidden="true">
      <span class="dots"><i /><i /><i /></span>
      <span class="url">{{ url ?? 'https://server.example.ts.net:7683' }}</span>
    </div>
    <img :src="src" :alt="alt" :width="width ?? 1440" :height="height ?? 900" :loading="eager ? 'eager' : 'lazy'" decoding="async">
  </figure>
</template>

<style scoped>
.bf { margin: 0; border: 1px solid var(--line-strong); background: var(--bg-2); box-shadow: 0 40px 80px -30px rgba(0, 0, 0, .7); }
.bar { display: flex; align-items: center; gap: 14px; height: 32px; padding: 0 12px; border-bottom: 1px solid var(--line); }
.dots { display: flex; gap: 6px; }
.dots i { width: 9px; height: 9px; border: 1px solid var(--line-strong); }
.url { flex: 1; text-align: center; font: 11px/1 var(--mono); color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 40px; }
img { width: 100%; height: auto; }
</style>
