<script setup lang="ts">
// /grid/1…5: the landing page with one background grid variant, to compare
// them in a real browser. Not meant to be indexed.
import { parseGridVariant } from '~/utils/grid'

definePageMeta({ validate: route => parseGridVariant(route.params.n) !== null })

const route = useRoute()
const n = computed(() => parseGridVariant(route.params.n) ?? 1)
useHead({ meta: [{ name: 'robots', content: 'noindex' }] })
</script>

<template>
  <div>
    <GridSwitcher :n="n" />
    <HomePage :grid="n" />
  </div>
</template>
