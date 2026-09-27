<script setup lang="ts">
// Bandeau discret d'une machine qui a des agents Claude sans la barre d'état des
// quotas de wherdr : « Installer » (le serveur l'installe sur la machine) et
// « Copier la commande » (commande autonome à coller là-bas). Installée mais pas
// encore de lecture : simple note, les quotas viennent au prochain échange.
import type { ClaudeSetup } from '#shared/types'
import { claudeInstallCommand } from '~/utils/quotas'

const props = defineProps<{ setup: ClaudeSetup, name: string }>()
const busy = ref(false)

async function install() {
  haptic()
  const ok = await askConfirm(
    tl(`Installer la barre d’état des quotas Claude sur ${props.name} ? Elle n’affiche rien et garde une barre d’état existante (~/.claude/settings.json, copie de sauvegarde).`,
      `Install the Claude quota status line on ${props.name}? It displays nothing and keeps any existing status line (~/.claude/settings.json, backup copy).`),
    t('Installer'), 'primary',
  )
  if (!ok) return
  busy.value = true
  try {
    await api('/api/claude-statusline', { key: props.setup.key })
    toast(tl(`Installé sur ${props.name}. Les quotas apparaîtront après le prochain échange avec un Claude.`,
      `Installed on ${props.name}. Quotas will show after the next exchange with a Claude.`))
    await reloadQuotas()
  } catch (err) { toast((err as Error).message, true) }
  finally { busy.value = false }
}

async function copy() {
  haptic()
  try {
    await navigator.clipboard.writeText(claudeInstallCommand)
    toast(tl(`Commande copiée : colle-la dans un terminal de ${props.name}.`, `Command copied: paste it into a terminal on ${props.name}.`))
  } catch { toast(t('Copie impossible'), true) }
}
</script>

<template>
  <div class="claude-setup" :class="setup.state">
    <UIcon :name="setup.state === 'pending' ? 'i-lucide-clock' : 'i-lucide-gauge'" class="claude-setup-icon" />
    <p v-if="setup.state === 'pending'">
      {{ tl(`Quotas Claude installés sur ${name}`, `Claude quotas installed on ${name}`) }}
      <small>{{ t('Ils apparaîtront après le prochain échange avec un Claude.') }}</small>
    </p>
    <template v-else>
      <p>{{ tl(`Quotas Claude non configurés sur ${name}`, `Claude quotas not set up on ${name}`) }}</p>
      <div class="claude-setup-actions">
        <UButton v-if="setup.installable" size="sm" color="primary" variant="solid" class="hw-cta" icon="i-lucide-download" :loading="busy" @click="install">
          {{ t('Installer') }}
        </UButton>
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-copy" @click="copy">{{ t('Copier la commande') }}</UButton>
      </div>
    </template>
  </div>
</template>
