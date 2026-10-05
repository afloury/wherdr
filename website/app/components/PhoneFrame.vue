<script setup lang="ts">
// A dark titanium iPhone (Dynamic Island, side buttons) around a phone
// screenshot, with the black iOS status bar the installed app uses.
// Body, bezel, button and island geometry are adapted from Inspira UI's
// iPhone15ProMockup (https://github.com/unovue/inspira-ui,
// app/components/inspira/ui/iphone-mockup/iPhone15ProMockup.vue, MIT License,
// Copyright (c) 2024-2026 rahulv.dev). The original draws a 433 × 882 phone;
// here the body is stretched vertically so the screen fits the status bar plus
// the uncropped 780 × 1688 screenshot, and the screenshot is a real <img>.
defineProps<{ src: string, alt: string, eager?: boolean }>()
</script>

<template>
  <figure class="pf">
    <!-- viewBox 433 × 935.3: screen 389.5 × 896.8 = 54 pt status bar + 390 × 844 pt shot, scaled. -->
    <svg class="body" viewBox="0 0 433 935.3" aria-hidden="true">
      <defs>
        <linearGradient id="pf-ti" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#6b7482" />
          <stop offset=".45" stop-color="#3b424d" />
          <stop offset="1" stop-color="#5a6270" />
        </linearGradient>
      </defs>
      <!-- Side buttons: action, volume up, volume down, power. -->
      <rect x="0" y="170" width="4" height="34" rx="1" fill="url(#pf-ti)" />
      <rect x="1" y="233" width="3.5" height="67" rx="1" fill="url(#pf-ti)" />
      <rect x="1" y="318" width="3.5" height="67" rx="1" fill="url(#pf-ti)" />
      <rect x="429" y="279" width="4" height="106" rx="1" fill="url(#pf-ti)" />
      <!-- Titanium band, then the black glass bezel. -->
      <rect x="2" y="0" width="428" height="935.3" rx="73" fill="url(#pf-ti)" />
      <rect x="5" y="3" width="422" height="929.3" rx="70.5" fill="#05070a" stroke="#000" stroke-width="1" />
      <rect x="6" y="4" width="420" height="927.3" rx="70" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="1" />
      <!-- Earpiece slit. -->
      <path opacity=".5" fill="#3b424d" d="M174 5H258V5.5C258 6.6 257.1 7.5 256 7.5H176C174.9 7.5 174 6.6 174 5.5V5Z" />
    </svg>
    <div class="screen">
      <div class="status" aria-hidden="true">
        <span class="time">9:41</span>
        <span class="icons"><i class="sig" /><i class="bat" /></span>
      </div>
      <img :src="src" :alt="alt" width="780" height="1688" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="eager ? 'high' : undefined" decoding="async">
    </div>
    <svg class="island" viewBox="154 30 124 37" aria-hidden="true">
      <path fill="#000" d="M154 48.5C154 38.28 162.28 30 172.5 30H259.5C269.72 30 278 38.28 278 48.5C278 58.72 269.72 67 259.5 67H172.5C162.28 67 154 58.72 154 48.5Z" />
      <circle cx="259.5" cy="48.5" r="7" fill="#0b0f16" />
      <circle cx="259.5" cy="48.5" r="3.4" fill="#16233a" />
    </svg>
  </figure>
</template>

<style scoped>
.pf { position: relative; margin: 0; width: 100%; aspect-ratio: 433 / 935.3; filter: drop-shadow(0 40px 40px rgba(0, 0, 0, .55)); }
.body { position: absolute; inset: 0; width: 100%; height: 100%; }
/* Screen rect in viewBox units: x 21.25, y 19.25, 389.5 × 896.8, corner 55.75. */
.screen {
  position: absolute; left: 4.9076%; top: 2.0582%; width: 89.9538%; height: 95.8836%;
  border-radius: 14.313% / 6.2166%; overflow: hidden; background: #000; container-type: inline-size;
}
/* Status bar of a Dynamic Island iPhone: 54 pt over 390 pt of width. */
.status {
  display: flex; align-items: center; justify-content: space-between;
  height: 13.85cqw; padding: 0 7.5% 0 11%;
  background: #000; color: #fff; font: 600 4.1cqw/1 var(--sans);
}
.time { width: 20%; text-align: center; }
.icons { display: flex; gap: 1.4cqw; align-items: center; }
.sig { width: 4.4cqw; height: 2.8cqw; background: #fff; clip-path: polygon(0 70%, 20% 70%, 20% 100%, 0 100%, 0 70%, 27% 45%, 47% 45%, 47% 100%, 27% 100%, 27% 45%, 54% 20%, 74% 20%, 74% 100%, 54% 100%, 54% 20%, 81% 0, 100% 0, 100% 100%, 81% 100%, 81% 0); }
.bat { width: 6.4cqw; height: 3cqw; border: 1px solid #fff; border-radius: 1cqw; padding: 1px; background: #fff; background-clip: content-box; }
img { display: block; width: 100%; height: auto; }
/* Island: x 154–278, y 30–67 in viewBox units. */
.island { position: absolute; left: 35.566%; top: 3.2075%; width: 28.637%; height: auto; }
</style>
