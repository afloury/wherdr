<script setup lang="ts">
// A conversation with nothing kept on this device yet, while its end loads (ChatView,
// after 300 ms): the shapes of its last blocks, at the bottom where the messages will
// show, above the real (usable) field. Static: no shimmer, no pulse.
defineProps<{ agent?: string | null }>()
</script>

<template>
  <div class="chat-skel" aria-hidden="true">
    <div class="skel-user"><i style="width: 78%" /><i style="width: 52%" /></div>
    <div class="skel-who" :class="agent || ''" />
    <div class="skel-tool"><span /><i style="width: 62%" /></div>
    <div class="skel-lines"><i style="width: 92%" /><i style="width: 84%" /><i style="width: 66%" /></div>
    <div class="skel-user"><i style="width: 64%" /></div>
    <div class="skel-who" :class="agent || ''" />
    <div class="skel-lines"><i style="width: 90%" /><i style="width: 86%" /><i style="width: 80%" /><i style="width: 42%" /></div>
  </div>
</template>
