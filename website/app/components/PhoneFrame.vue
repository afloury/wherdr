<script setup lang="ts">
// An iPhone-like frame (1 px lines, no gloss) around a phone screenshot, with
// the black iOS status bar the installed app uses.
defineProps<{ src: string, alt: string, eager?: boolean }>()
</script>

<template>
  <figure class="pf">
    <div class="screen">
      <div class="status" aria-hidden="true">
        <span>9:41</span>
        <span class="island" />
        <span class="icons"><i class="sig" /><i class="bat" /></span>
      </div>
      <img :src="src" :alt="alt" width="780" height="1688" :loading="eager ? 'eager' : 'lazy'" decoding="async">
    </div>
  </figure>
</template>

<style scoped>
.pf {
  margin: 0; padding: 3%; width: 100%;
  background: #07090c; border: 1px solid var(--line-strong); border-radius: 13% / 6%;
  box-shadow: 0 0 0 1px #000, 0 50px 90px -30px rgba(0, 0, 0, .85);
}
.screen { position: relative; border-radius: 10% / 4.6%; overflow: hidden; background: var(--bg); container-type: inline-size; }
/* iOS status bar: 47 pt over 390 pt of width. */
.status {
  position: relative; display: flex; align-items: center; justify-content: space-between;
  height: 12cqw; padding: 0 8% 0 10%;
  background: #000; color: #fff; font: 600 4cqw/1 var(--sans);
}
.island { position: absolute; top: 50%; left: 50%; width: 30%; height: 55%; transform: translate(-50%, -50%); background: #000; border-radius: 99px; box-shadow: 0 0 0 1px #15181d; }
.icons { display: flex; gap: 1.4cqw; align-items: center; }
.sig { width: 4.4cqw; height: 2.8cqw; background: #fff; clip-path: polygon(0 70%, 20% 70%, 20% 100%, 0 100%, 0 70%, 27% 45%, 47% 45%, 47% 100%, 27% 100%, 27% 45%, 54% 20%, 74% 20%, 74% 100%, 54% 100%, 54% 20%, 81% 0, 100% 0, 100% 100%, 81% 100%, 81% 0); }
.bat { width: 6.4cqw; height: 3cqw; border: 1px solid #fff; border-radius: 1cqw; padding: 1px; background: #fff; background-clip: content-box; }
img { width: 100%; height: auto; display: block; }
</style>
