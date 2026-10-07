<script setup lang="ts">
// Push notifications card: enable them on this device, then send a test.
// Settings › Notifications and the onboarding's security step.
async function pushAction() {
  if (await pushSubscribed()) await testPush()
  else await enablePush()
  refreshPushOn()
}
const pushNote = computed(() => t(pushOn.value
  ? 'You are notified when an agent needs your input or finishes.'
  : isIOS && !standalone
    ? 'On iPhone, add the app to your Home Screen (Share → Add to Home Screen) to receive notifications.'
    : 'Enable notifications to know when an agent needs your input.'))
onMounted(refreshPushOn)
</script>

<template>
  <div class="settings-card">
    <button type="button" class="settings-action" @click="pushAction">
      <UIcon name="i-lucide-bell" />{{ t(pushOn ? 'Send a test notification' : 'Enable notifications') }}
    </button>
    <p class="muted">{{ pushNote }}</p>
  </div>
</template>
