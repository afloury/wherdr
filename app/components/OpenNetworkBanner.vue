<script setup lang="ts">
// wherdr started with WHERDR_TRUSTED_NETWORKS=any (server/utils/network.ts):
// it accepts every network, in plain HTTP. A warning that cannot be hidden,
// on the home screen and in Settings › Security, until the setting is removed.
</script>

<template>
  <div v-if="appConfig.openNetwork" class="update-banner open-network-banner" role="alert">
    <UIcon name="i-lucide-shield-alert" class="update-banner-icon" />
    <div class="update-banner-body">
      <p>{{ tl('wherdr accepts every network', 'wherdr accepte tous les réseaux') }}<small>{{ tl('Anyone who can reach this machine, on a Wi-Fi or a LAN, can control your agents. Remove WHERDR_TRUSTED_NETWORKS=any and restart wherdr, or turn on the passkey lock.', 'Toute personne qui joint cette machine, sur un Wi-Fi ou un réseau local, peut piloter tes agents. Retire WHERDR_TRUSTED_NETWORKS=any et redémarre wherdr, ou active le verrou passkey.') }}</small></p>
    </div>
  </div>
</template>
