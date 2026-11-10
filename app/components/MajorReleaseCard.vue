<script setup lang="ts">
// "wherdr 3 is out" card: shown on Home instead of the update banner when a
// newer major is published. A new major installs beside this one, never over
// it, so there is no Update button: release notes, migration guide, and the
// install-beside command to copy.
import { majorOf, type MajorMove } from '#shared/updates'

const props = defineProps<{ next: MajorMove, dismissible?: boolean }>()

async function copy() {
  haptic()
  try {
    await navigator.clipboard.writeText(props.next.command)
    toast(t('Command copied: run it on the server. It only shows its plan until you add --yes.'))
  } catch { toast(t('Copy failed'), true) }
}
</script>

<template>
  <div class="update-banner major-release-card">
    <UIcon name="i-lucide-sparkles" class="update-banner-icon" />
    <div class="update-banner-body">
      <p>{{ t(`wherdr ${majorOf(next.version)} is out: what changes, how to move`) }}
        <small>{{ t(`wherdr ${next.version} installs beside this version, which keeps running with its data. Updates of this version continue.`) }}</small>
      </p>
      <code>{{ next.command }}</code>
    </div>
    <div class="update-banner-actions">
      <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-external-link" :to="next.url" target="_blank" rel="noopener noreferrer">{{ t('Release notes') }}</UButton>
      <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-book-open" :to="next.guide" target="_blank" rel="noopener noreferrer">{{ t('Migration guide') }}</UButton>
      <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-copy" @click="copy">{{ t('Copy command') }}</UButton>
      <UButton v-if="dismissible" size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('Hide')" @click="dismissMajor" />
    </div>
  </div>
</template>
