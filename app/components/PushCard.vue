<script setup lang="ts">
// Push notifications card: allow them on this device, then send a test.
// Settings › Notifications (`detailed`: says what the browser allows, and
// that what notifies is set above) and the onboarding's security step.
defineProps<{ detailed?: boolean }>()
type Permission = 'granted' | 'denied' | 'default' | 'unsupported'
const permission = ref<Permission>('default')
function readPermission() {
  permission.value = typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) ? 'unsupported' : Notification.permission
}
async function pushAction() {
  if (await pushSubscribed()) await testPush()
  else await enablePush()
  readPermission()
  refreshPushOn()
}
const pushNote = computed(() => t(pushOn.value
  ? 'You are notified when an agent needs your input or finishes.'
  : isIOS && !standalone
    ? 'On iPhone, add the app to your Home Screen (Share → Add to Home Screen) to receive notifications.'
    : 'Enable notifications to know when an agent needs your input.'))
const stateLabel = computed(() => permission.value === 'unsupported'
  ? t('Not available in this browser')
  : permission.value === 'denied' ? t('Blocked')
    : permission.value === 'granted' ? (pushOn.value ? t('Allowed') : t('Allowed, but this device is not registered yet'))
      : t('Not asked yet'))
const stateHint = computed(() => permission.value === 'denied'
  ? t('This browser blocks notifications from wherdr. Allow them in the site settings of the browser (or in the system settings), then come back.')
  : permission.value === 'unsupported' && isIOS && !standalone
    ? t('On iPhone, add the app to your Home Screen (Share → Add to Home Screen) to receive notifications.') : '')
onMounted(() => { readPermission(); refreshPushOn() })
</script>

<template>
  <div v-if="detailed" class="settings-card push-card" data-testid="push-card">
    <p class="muted">{{ t('This only asks this browser or phone for permission to show notifications. What notifies is set above.') }}</p>
    <p class="push-state"><span>{{ t('Permission') }}</span><b :class="`push-${permission}`">{{ stateLabel }}</b></p>
    <p v-if="stateHint" class="muted">{{ stateHint }}</p>
    <button v-if="permission !== 'denied' && permission !== 'unsupported'" type="button" class="settings-action" @click="pushAction">
      <UIcon :name="pushOn ? 'i-lucide-send' : 'i-lucide-bell'" />{{ pushOn ? t('Send a test notification') : t('Allow') }}
    </button>
  </div>
  <div v-else class="settings-card">
    <button type="button" class="settings-action" @click="pushAction">
      <UIcon name="i-lucide-bell" />{{ t(pushOn ? 'Send a test notification' : 'Enable notifications') }}
    </button>
    <p class="muted">{{ pushNote }}</p>
  </div>
</template>

<style scoped>
.push-card { display:flex; flex-direction:column; gap:10px; }
.push-card p { margin:0; }
.push-state { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.push-granted { color:var(--green); }
.push-denied { color:var(--danger); }
</style>
