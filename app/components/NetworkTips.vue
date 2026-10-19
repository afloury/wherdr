<script setup lang="ts">
// Short network advice, shown in Settings › Security and the setup guide.
// wherdr never requires a passkey: it recommends Tailscale and a passkey once
// the access is HTTPS (WebAuthn, installed app and notifications need it).
</script>

<template>
  <div class="network-tips">
    <p class="network-tips-label">{{ tl('Good practices', 'Bonnes pratiques') }}</p>
    <ul>
      <li><UIcon name="i-lucide-shield-check" />{{ tl('Prefer Tailscale: a private HTTPS address, only for your devices.', 'Préfère Tailscale : une adresse HTTPS privée, pour tes appareils seulement.') }}</li>
      <li><UIcon name="i-lucide-wifi" />{{ tl('A network added without HTTPS gets no passkey, no installed app and no notifications, and any device on it can control your agents.', 'Un réseau ajouté sans HTTPS n’a ni passkey, ni app installée, ni notifications, et tout appareil de ce réseau peut piloter tes agents.') }}</li>
      <li><UIcon name="i-lucide-lock" />{{ tl('Create a passkey as soon as wherdr is reached over HTTPS.', 'Crée une passkey dès que wherdr est joint en HTTPS.') }}</li>
    </ul>
  </div>
</template>
