<script setup lang="ts">
// Settings › Plugins › wherdr plugins: the plugins found in DATA_DIR/plugins,
// their state, and a switch each. A plugin that failed stays off with its message.
// Nothing loads while Community plugins is off: each plugin keeps its switch, greyed.
const rows = clientPlugins
onMounted(() => { startClientPlugins() })
async function setCommunity(on: boolean) {
  if (on && !(await askConfirm(t('Plugins run inside wherdr with full access: they can read your conversations, write to your agents and run commands on your machines. Only turn this on for plugins you trust.'), t('Turn on')))) return
  communityPlugins.value = on
}
const stateText = (s: string) => ({
  running: tl('On', 'Activé'), off: tl('Off', 'Désactivé'), failed: tl('Disabled after an error', 'Désactivé après une erreur'), loading: tl('Loading…', 'Chargement…'),
}[s] || s)
</script>

<template>
  <div class="settings-group client-plugins">
    <h3>{{ tl('wherdr plugins', 'Plugins wherdr') }}</h3>
    <label class="settings-toggle" data-wherdr="community-plugins">
      <span><b>{{ t('Community plugins') }}</b><small>{{ t('Lets the plugins below load, with full access to wherdr. Off by default. Applies to every device.') }}</small></span>
      <USwitch :model-value="communityPlugins" size="xl" @update:model-value="setCommunity" />
    </label>
    <p v-if="!rows.length" class="client-plugins-empty">
      {{ tl('No plugin installed. Put a plugin folder in the plugins folder of the data directory (plugins/<name>/manifest.json) and reload the page.', 'Aucun plugin installé. Dépose un dossier de plugin dans le dossier plugins du dossier de données (plugins/<nom>/manifest.json) puis recharge la page.') }}
    </p>
    <ul v-else class="client-plugins-list" :class="{ paused: !communityPlugins }">
      <li v-for="p in rows" :key="p.id" class="client-plugin" :class="p.status" :data-plugin="p.id">
        <div class="client-plugin-head">
          <strong>{{ p.name }}</strong>
          <small v-if="p.version">{{ p.version }}</small>
          <span v-if="communityPlugins" class="client-plugin-state">{{ stateText(p.status) }}</span>
          <USwitch
            :model-value="communityPlugins ? p.status === 'running' || p.status === 'loading' : p.wanted" :aria-label="p.name" :disabled="!communityPlugins"
            @update:model-value="(v: boolean) => setClientPluginEnabled(p.id, v)"
          />
        </div>
        <p v-if="p.description" class="client-plugin-note">{{ p.description }}</p>
        <p v-if="p.status === 'failed'" class="client-plugin-error" role="alert">{{ p.error }}</p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.client-plugins-empty, .client-plugin-note { color: var(--dim); font-size: 13px; margin: 6px 0; }
.client-plugins-list { list-style: none; margin: 0; padding: 0; }
.client-plugin { border-top: 1px solid var(--line); padding: 10px 0; }
/* Community plugins off: each plugin keeps its switch, greyed. */
.client-plugins-list.paused .client-plugin { opacity: .5; }
.client-plugin-head { display: flex; align-items: center; gap: 8px; }
.client-plugin-head strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.client-plugin-head small, .client-plugin-state { font-family: var(--font-mono, monospace); font-size: 11px; text-transform: uppercase; color: var(--dim); }
.client-plugin-error { margin: 6px 0 0; padding: 6px 8px; border: 1px solid var(--red, #c33); color: var(--red, #c33); font-family: var(--font-mono, monospace); font-size: 12px; overflow-wrap: anywhere; }
</style>
