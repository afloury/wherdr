<script setup lang="ts">
// herdr-projects missing, a 0.2, or a 1.x older than 1.2.1 on a machine: what
// to do, with the commands. wherdr reads 1.2.1 and later only; 1.3.4 is the
// last wherdr that reads 0.2 (shared/projectsPlugin.ts).
import {
  PROJECTS_COMMAND, PROJECTS_MIGRATION_GUIDE, PROJECTS_MIN, PROJECTS_UPGRADE_COMMAND,
  WHERDR_DOWNGRADE_COMMANDS, WHERDR_LAST_02,
} from '#shared/projectsPlugin'

const props = defineProps<{ status: 'missing' | 'old', version?: string | null, machine?: string }>()
// A 0.2 (or a version Herdr does not give): its projects are set aside by 1.x.
const is02 = computed(() => !props.version || !/^[1-9]/.test(props.version))
const install = computed(() => (props.status === 'missing' ? PROJECTS_COMMAND : PROJECTS_UPGRADE_COMMAND))

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('Copied'))
  } catch { toast(tl('Copy failed', 'Copie impossible'), true) }
}
</script>

<template>
  <div class="plugin-input-note warn projects-upgrade" role="note">
    <UIcon name="i-lucide-triangle-alert" />
    <div>
      <strong>{{ tl(`Update herdr-projects to ${PROJECTS_MIN} or later, or downgrade wherdr to ${WHERDR_LAST_02}`, `Mets herdr-projects à jour en ${PROJECTS_MIN} ou plus, ou reviens à wherdr ${WHERDR_LAST_02}`) }}</strong>
      <p v-if="status === 'old'">
        {{ version
          ? tl(`${machine ? `${machine} has` : 'This machine has'} herdr-projects ${version}. This version of wherdr reads herdr-projects ${PROJECTS_MIN} and later only.`, `${machine ? `${machine} a` : 'Cette machine a'} herdr-projects ${version}. Cette version de wherdr ne lit que herdr-projects ${PROJECTS_MIN} et plus.`)
          : tl(`This version of wherdr reads herdr-projects ${PROJECTS_MIN} and later only.`, `Cette version de wherdr ne lit que herdr-projects ${PROJECTS_MIN} et plus.`) }}
      </p>
      <p v-else>{{ tl(`herdr-projects is not installed${machine ? ` on ${machine}` : ''}. The Board shows its tasks from version ${PROJECTS_MIN} on.`, `herdr-projects n’est pas installé${machine ? ` sur ${machine}` : ''}. Le Board affiche ses tâches à partir de la version ${PROJECTS_MIN}.`) }}</p>

      <p class="projects-upgrade-step">{{ status === 'missing' ? tl('Install it:', 'L’installer :') : is02 ? tl('Update it (your 0.2 projects are set aside in ~/.herdr-projects-legacy, never deleted):', 'La mettre à jour (tes projets 0.2 sont mis de côté dans ~/.herdr-projects-legacy, jamais supprimés) :') : tl('Update it:', 'La mettre à jour :') }}</p>
      <div class="projects-upgrade-cmd">
        <code class="projects-plugin-command">{{ install }}</code>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-copy" :aria-label="t('Copy command')" @click="copy(install)" />
      </div>

      <template v-if="status === 'old'">
        <p class="projects-upgrade-step">{{ tl(`Or go back to wherdr ${WHERDR_LAST_02}, the last version for herdr-projects 0.2. With npm:`, `Ou revenir à wherdr ${WHERDR_LAST_02}, la dernière version pour herdr-projects 0.2. Avec npm :`) }}</p>
        <div class="projects-upgrade-cmd">
          <code class="projects-plugin-command">{{ WHERDR_DOWNGRADE_COMMANDS[0] }}</code>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-copy" :aria-label="t('Copy command')" @click="copy(WHERDR_DOWNGRADE_COMMANDS[0])" />
        </div>
        <p class="projects-upgrade-step">{{ tl(`With Docker: in docker-compose.yml, change the image tag from latest to ${WHERDR_LAST_02}, then:`, `Avec Docker : dans docker-compose.yml, remplace le tag latest de l’image par ${WHERDR_LAST_02}, puis :`) }}</p>
        <div class="projects-upgrade-cmd">
          <code class="projects-plugin-command">{{ WHERDR_DOWNGRADE_COMMANDS[1] }}</code>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-copy" :aria-label="t('Copy command')" @click="copy(WHERDR_DOWNGRADE_COMMANDS[1])" />
        </div>
      </template>
      <p class="projects-upgrade-step">{{ tl('Step by step, with a backup and the way back:', 'Pas à pas, avec la sauvegarde et le retour arrière :') }} <code>{{ PROJECTS_MIGRATION_GUIDE }}</code> {{ tl('in wherdr’s repository.', 'dans le dépôt de wherdr.') }}</p>
    </div>
  </div>
</template>
