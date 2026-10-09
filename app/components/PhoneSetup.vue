<script setup lang="ts">
// "Use it on your phone": publish wherdr on the tailnet (Tailscale, private to
// your devices), check live that the address answers, then its QR code.
// Settings › Phone, and the onboarding. Server side: server/utils/phone.ts.
import type { PhoneError, PhoneResult, PhoneStatus } from '#shared/phone'
import pkg from '../../package.json'

const props = defineProps<{ active: boolean }>()

const status = ref<PhoneStatus | null>(null)
const denied = ref(false)
// Denied on an HTTPS address: the page itself came through the phone address.
const onPhoneAddress = import.meta.client && location.protocol === 'https:'
const busy = ref(false)
const failure = ref<{ error: PhoneError, link?: string, detail?: string } | null>(null)
const typed = ref('')
let timer: ReturnType<typeof setTimeout> | null = null
// Shared with the guide and the passkey card (usePhoneAddress.ts).
watch(status, (s) => { if (s) phoneAddress.value = s })

async function refresh() {
  try {
    status.value = await api<PhoneStatus>('/api/phone')
    denied.value = false
    if (!typed.value) typed.value = status.value.url || status.value.suggested || ''
  } catch (e) {
    denied.value = (e as ApiError).code === 'phone_local'
  }
}

// Checked again every few seconds while shown, faster until it answers.
function schedule() {
  if (timer) clearTimeout(timer)
  if (!props.active) return
  timer = setTimeout(async () => { await refresh(); schedule() }, status.value?.reach === 'ok' ? 15000 : 4000)
}
watch(() => props.active, async (on) => { if (on) { await refresh(); schedule() } else if (timer) clearTimeout(timer) }, { immediate: true })
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

// Result of the last check asked by hand (Check, Check again, publish):
// shown next to the button with its time, and the state rows flash. Either a
// fixed message (`text`: an error before any check), or live: read from the
// current status, so it never disagrees with the state rows above it.
const result = ref<{ ok: boolean, text: string, at: number } | { live: true, at: number } | null>(null)
const flash = ref(0)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 10_000) })
onBeforeUnmount(() => { if (clock) clearInterval(clock) })
function report(ok: boolean, text: string) {
  result.value = { ok, text, at: status.value?.checkedAt || Date.now() }
  now.value = Date.now()
  flash.value++
}
const pendingText = computed(() => tl('Getting the HTTPS certificate from Tailscale… this can take up to a minute.', 'Tailscale obtient le certificat HTTPS… cela peut prendre jusqu’à une minute.'))
const shown = computed<{ state: 'ok' | 'bad' | 'wait', text: string, at: number } | null>(() => {
  const r = result.value
  const s = status.value
  if (!r) return null
  if (!('live' in r)) return { state: r.ok ? 'ok' : 'bad', text: r.text, at: r.at }
  if (!s) return null
  const at = s.checkedAt || r.at
  if (s.url) {
    if (s.reach === 'ok') return { state: 'ok', text: tl('Reachable', 'Joignable'), at }
    if (s.reach === 'pending') return { state: 'wait', text: pendingText.value, at }
    return { state: 'bad', text: reachText.value, at }
  }
  if (needsTailscale.value) return { state: 'bad', text: s.mode === 'missing' ? tl('Tailscale is still not found on this computer.', 'Tailscale est toujours introuvable sur cet ordinateur.') : tl('Tailscale is still not connected on this computer.', 'Tailscale n’est toujours pas connecté sur cet ordinateur.'), at }
  return { state: 'ok', text: tl('Tailscale is ready.', 'Tailscale est prêt.'), at }
})
const RESULT_ICONS = { ok: 'i-lucide-check', bad: 'i-lucide-x', wait: 'i-lucide-loader-circle' }
const resultWhen = computed(() => {
  if (!shown.value) return ''
  return now.value - shown.value.at < 60_000
    ? tl('checked just now', 'vérifié à l’instant')
    : tl(`checked at ${fmtTime(shown.value.at)}`, `vérifié à ${fmtTime(shown.value.at)}`)
})

async function act(body: Record<string, unknown>) {
  busy.value = true
  failure.value = null
  try {
    const r = await api<PhoneResult>('/api/phone', body)
    status.value = r.status
    if (!r.ok) {
      failure.value = { error: r.error, link: r.link, detail: r.detail }
      report(false, failureText.value)
    } else reportReach()
  } catch (e) { report(false, (e as Error).message) }
  finally { busy.value = false; schedule() }
}

// The outcome of the address check, or of the Tailscale state without one:
// live, it follows the automatic checks (waiting → reachable).
function reportReach() {
  if (!status.value) return
  result.value = { live: true, at: Date.now() }
  now.value = Date.now()
  flash.value++
}

async function publish() {
  const yes = await askConfirm(
    tl('Make wherdr reachable from your phone? It is published on your tailnet only: private, reachable by your Tailscale devices, never the public Internet.', 'Rendre wherdr joignable depuis ton téléphone ? Il est publié sur ton tailnet seulement : privé, joignable par tes appareils Tailscale, jamais par Internet.'),
    tl('Publish', 'Publier'), 'primary', status.value?.command || '')
  if (yes) await act({ action: 'publish' })
}

async function unpublish() {
  const yes = await askConfirm(tl('Remove wherdr from your tailnet? Your phone will no longer reach it.', 'Retirer wherdr de ton tailnet ? Ton téléphone ne le joindra plus.'), tl('Remove', 'Retirer'))
  if (yes) await act({ action: 'unpublish' })
}

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(status.value?.command || '')
    toast(tl('Command copied: paste it into a terminal on the computer that runs Docker.', 'Commande copiée : colle-la dans un terminal de l’ordinateur qui fait tourner Docker.'))
  } catch { toast(t('Copy failed'), true) }
}

// Tailscale missing or disconnected: why it is needed, and three steps.
const needsTailscale = computed(() => status.value?.mode === 'missing' || (status.value?.mode === 'native' && !status.value.connected))
const DOWNLOADS: Record<string, string> = { darwin: 'https://tailscale.com/download/mac', win32: 'https://tailscale.com/download/windows', linux: 'https://tailscale.com/download/linux' }
const downloadUrl = computed(() => DOWNLOADS[status.value?.platform || ''] || 'https://tailscale.com/download')
// Headscale, NetBird, ZeroTier, WireGuard, Cloudflare Tunnel + Access: documented
// in the README (repository URL from package.json), not automated.
const OTHER_NETWORKS_DOC = pkg.bugs.replace(/\/issues$/, '#other-private-networks')
const checking = ref(false)
async function checkAgain() {
  checking.value = true
  try { await refresh(); if (denied.value) report(false, tl('Only from the computer that runs wherdr.', 'Seulement depuis l’ordinateur qui fait tourner wherdr.')); else reportReach() }
  catch (e) { report(false, (e as Error).message) }
  finally { checking.value = false; schedule() }
}

const reachText = computed(() => {
  const s = status.value
  if (!s?.url) return ''
  if (s.reach === 'ok') return tl('Your phone can open it.', 'Ton téléphone peut l’ouvrir.')
  if (s.reach === 'pending') return pendingText.value
  if (s.reach === 'host') return tl(`wherdr answers but refuses this address: APP_URL is set to ${s.appUrl} in its environment.`, `wherdr répond mais refuse cette adresse : APP_URL vaut ${s.appUrl} dans son environnement.`)
  if (s.reach === 'other' || !s.reach) return tl(`Something answers (HTTP ${s.reachStatus}), but not wherdr: is wherdr running on this port?`, `Quelque chose répond (HTTP ${s.reachStatus}), mais pas wherdr : wherdr tourne-t-il sur ce port ?`)
  switch (s.reachCause) {
    case 'dns': return tl('Address not found (DNS): check the machine name, and that MagicDNS is on in Tailscale.', 'Adresse introuvable (DNS) : vérifie le nom de la machine, et que MagicDNS est activé dans Tailscale.')
    case 'refused': return tl('Connection refused: nothing is published on this port. Run the command above.', 'Connexion refusée : rien n’est publié sur ce port. Lance la commande ci-dessus.')
    case 'cert': return tl('Invalid certificate: turn on HTTPS for your tailnet, then wait a minute for the certificate.', 'Certificat invalide : active HTTPS pour ton tailnet, puis attends une minute le certificat.')
    case 'tls': return tl('No HTTPS on this port: publish it with tailscale serve --https.', 'Pas de HTTPS sur ce port : publie-le avec tailscale serve --https.')
    case 'timeout': return tl('Timed out. The first visit can take up to a minute: Tailscale gets the HTTPS certificate.', 'Délai dépassé. La première visite peut prendre jusqu’à une minute : Tailscale obtient le certificat HTTPS.')
    default: return tl('Not reachable yet. The first visit can take up to a minute: Tailscale gets the HTTPS certificate.', 'Pas encore joignable. La première visite peut prendre jusqu’à une minute : Tailscale obtient le certificat HTTPS.')
  }
})

const failureText = computed(() => {
  switch (failure.value?.error) {
    case 'operator': return tl('Tailscale refused: this user may not change its settings. Run once in a terminal: sudo tailscale set --operator=$USER, then try again.', 'Tailscale a refusé : cet utilisateur ne peut pas modifier ses réglages. Lance une fois dans un terminal : sudo tailscale set --operator=$USER, puis réessaie.')
    case 'https': return tl('HTTPS certificates are off on your tailnet. Turn on HTTPS in the Tailscale admin console (DNS page), then try again.', 'Les certificats HTTPS sont désactivés sur ton tailnet. Active HTTPS dans la console d’administration Tailscale (page DNS), puis réessaie.')
    case 'offline': return tl('Tailscale is not connected on this computer. Open the Tailscale app (or run tailscale up), then try again.', 'Tailscale n’est pas connecté sur cet ordinateur. Ouvre l’app Tailscale (ou lance tailscale up), puis réessaie.')
    case 'taken': return tl(`HTTPS port ${status.value?.port} of your tailnet already serves something else: wherdr leaves it alone.`, `Le port HTTPS ${status.value?.port} de ton tailnet sert déjà autre chose : wherdr n’y touche pas.`)
    case 'address': return /^\s*http:/i.test(typed.value)
      ? tl('Not HTTPS: the address must start with https:// (tailscale serve --https).', 'Pas en HTTPS : l’adresse doit commencer par https:// (tailscale serve --https).')
      : tl('Paste the https://….ts.net address that tailscale serve printed.', 'Colle l’adresse https://….ts.net affichée par tailscale serve.')
    case 'failed': return tl('tailscale serve failed:', 'tailscale serve a échoué :')
    default: return ''
  }
})
</script>

<template>
  <div class="settings-group phone-setup">
    <h3>{{ tl('Use it on your phone', 'Utiliser sur ton téléphone') }}</h3>
    <p class="phone-intro">{{ tl('Your phone reaches wherdr through Tailscale: a private HTTPS address, only for your devices, never the public Internet.', 'Ton téléphone joint wherdr par Tailscale : une adresse HTTPS privée, pour tes appareils seulement, jamais Internet.') }} <a class="phone-other" :href="OTHER_NETWORKS_DOC" target="_blank" rel="noopener noreferrer">{{ tl('Using something else?', 'Tu utilises autre chose ?') }}</a></p>

    <p v-if="denied && onPhoneAddress" class="phone-note">{{ tl('You are on wherdr’s phone address, and it answers: open it on your phone and add it to the Home Screen. To publish or remove it, open wherdr on localhost on its computer, or unlock it with its passkey.', 'Tu es sur l’adresse téléphone de wherdr, et elle répond : ouvre-la sur ton téléphone et ajoute-la à l’écran d’accueil. Pour la publier ou la retirer, ouvre wherdr sur localhost sur son ordinateur, ou déverrouille-le avec sa passkey.') }}</p>
    <p v-else-if="denied" class="phone-note warn">{{ tl('Set it up from the computer that runs wherdr: open http://localhost:' + (status?.port || '7683') + ' there, or unlock wherdr with its passkey.', 'Configure-le depuis l’ordinateur qui fait tourner wherdr : ouvre http://localhost:' + (status?.port || '7683') + ' dessus, ou déverrouille wherdr avec sa passkey.') }}</p>
    <p v-else-if="!status" class="phone-note">{{ tl('Checking…', 'Vérification…') }}</p>

    <template v-else>
      <ol :key="flash" class="phone-steps" :class="{ 'phone-flash': flash > 0 }">
        <!-- 1. Tailscale -->
        <li :class="{ done: status.mode === 'docker' || status.connected }">
          <span class="phone-step-label">TAILSCALE</span>
          <p v-if="status.mode === 'missing'">{{ tl('Not installed on this computer.', 'Pas installé sur cet ordinateur.') }}</p>
          <p v-else-if="status.mode === 'docker'">{{ tl('wherdr runs in Docker: run the command below on the computer, in a terminal.', 'wherdr tourne dans Docker : lance la commande ci-dessous sur l’ordinateur, dans un terminal.') }}</p>
          <p v-else-if="status.connected">{{ tl('Connected.', 'Connecté.') }}</p>
          <p v-else>{{ tl('Installed, but not connected on this computer.', 'Installé, mais pas connecté sur cet ordinateur.') }}</p>
        </li>

        <!-- 2. Published -->
        <li v-if="status.mode === 'native' && status.connected" :class="{ done: status.served }">
          <span class="phone-step-label">{{ tl('TAILNET', 'TAILNET') }}</span>
          <template v-if="status.served">
            <p class="phone-url">{{ status.url }}</p>
            <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-unplug" :loading="busy" @click="unpublish">{{ tl('Remove from my tailnet', 'Retirer de mon tailnet') }}</UButton>
          </template>
          <template v-else>
            <p>{{ tl('Not reachable from your phone yet.', 'Pas encore joignable depuis ton téléphone.') }}</p>
            <UButton class="hw-cta" color="primary" icon="i-lucide-smartphone" :loading="busy" :disabled="!status.connected" @click="publish">{{ tl('Make wherdr reachable from my phone', 'Rendre wherdr joignable depuis mon téléphone') }}</UButton>
            <p v-if="!status.https && status.connected" class="phone-note">{{ tl('HTTPS certificates look off on your tailnet: turn them on first.', 'Les certificats HTTPS semblent désactivés sur ton tailnet : active-les d’abord.') }} <a class="phone-link" href="https://login.tailscale.com/admin/dns" target="_blank" rel="noopener noreferrer">{{ tl('Tailscale DNS settings', 'Réglages DNS Tailscale') }} <UIcon name="i-lucide-external-link" /></a></p>
          </template>
        </li>
        <li v-else-if="status.mode === 'docker'" :class="{ done: status.reach === 'ok' }">
          <span class="phone-step-label">{{ tl('TAILNET', 'TAILNET') }}</span>
          <div class="phone-command">
            <code>{{ status.command }}</code>
            <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-copy" @click="copyCommand">{{ tl('Copy', 'Copier') }}</UButton>
          </div>
          <p>{{ tl('Then paste the address it prints:', 'Puis colle l’adresse qu’elle affiche :') }}</p>
          <form class="phone-address" @submit.prevent="act({ action: 'address', url: typed })">
            <UInput v-model="typed" placeholder="https://machine.tailnet.ts.net:7683/" size="md" class="phone-address-input" autocomplete="off" spellcheck="false" />
            <UButton type="submit" size="md" color="neutral" variant="outline" :loading="busy">{{ tl('Check', 'Vérifier') }}</UButton>
          </form>
          <p v-if="shown" :key="`r${flash}`" class="phone-result" :class="shown.state" role="status">
            <UIcon :name="RESULT_ICONS[shown.state]" /><span>{{ shown.text }}</span><time>{{ resultWhen }}</time>
          </p>
        </li>

        <!-- 3. Answers -->
        <li v-if="status.url" :class="{ done: status.reach === 'ok', wait: status.reach === 'pending', bad: status.reach === 'host' || status.reach === 'other' || status.reach === 'unreachable' }" aria-live="polite">
          <span class="phone-step-label">{{ tl('ANSWERS', 'RÉPOND') }}</span>
          <p v-if="status.reach === 'pending'" class="phone-wait"><UIcon name="i-lucide-loader-circle" /><span>{{ reachText }}</span></p>
          <p v-else>{{ reachText }}</p>
        </li>

        <!-- 4. APP_URL -->
        <li v-if="status.reach === 'ok'" :class="{ done: status.appUrl === status.url }">
          <span class="phone-step-label">APP_URL</span>
          <p v-if="status.appUrl === status.url">{{ tl('Set to this address, for notifications. Nothing to restart.', 'Réglé sur cette adresse, pour les notifications. Rien à redémarrer.') }}</p>
          <p v-else>{{ tl(`APP_URL is set to ${status.appUrl} in wherdr's environment, which wins: change it there and restart wherdr for notifications to open this address.`, `APP_URL vaut ${status.appUrl} dans l’environnement de wherdr, qui l’emporte : change-le là et redémarre wherdr pour que les notifications ouvrent cette adresse.`) }}</p>
        </li>
      </ol>
      <p v-if="shown && status.mode === 'native' && !needsTailscale" :key="`r${flash}`" class="phone-result" :class="shown.state" role="status">
        <UIcon :name="RESULT_ICONS[shown.state]" /><span>{{ shown.text }}</span><time>{{ resultWhen }}</time>
      </p>

      <div v-if="needsTailscale" class="phone-guide">
        <p class="phone-guide-why">{{ tl('Your phone reaches wherdr through Tailscale: a private, encrypted link between your own devices only. Nothing is exposed on the Internet, and it is free for personal use. It also gives wherdr an HTTPS address, which the installed app, notifications and passkeys require.', 'Ton téléphone joint wherdr par Tailscale : un lien privé et chiffré, seulement entre tes appareils. Rien n’est exposé sur Internet, et c’est gratuit pour un usage perso. Tailscale donne aussi à wherdr une adresse HTTPS, obligatoire pour l’app installée, les notifications et les passkeys.') }}</p>
        <ol class="phone-guide-steps">
          <li>
            <b>{{ status.mode === 'missing' ? tl('Install Tailscale on this computer and sign in.', 'Installe Tailscale sur cet ordinateur et connecte-toi.') : tl('Open Tailscale on this computer and sign in.', 'Ouvre Tailscale sur cet ordinateur et connecte-toi.') }}</b>
            <a class="phone-link" :href="downloadUrl" target="_blank" rel="noopener noreferrer">{{ downloadUrl.replace('https://', '') }} <UIcon name="i-lucide-external-link" /></a>
          </li>
          <li>
            <b>{{ tl('Install Tailscale on your phone, with the same account.', 'Installe Tailscale sur ton téléphone, avec le même compte.') }}</b>
            <span class="phone-guide-links">
              <a class="phone-link" href="https://apps.apple.com/app/tailscale/id1470499037" target="_blank" rel="noopener noreferrer">App Store <UIcon name="i-lucide-external-link" /></a>
              <a class="phone-link" href="https://play.google.com/store/apps/details?id=com.tailscale.ipn" target="_blank" rel="noopener noreferrer">Google Play <UIcon name="i-lucide-external-link" /></a>
            </span>
          </li>
          <li>
            <b>{{ tl('Turn on HTTPS for your tailnet in the Tailscale admin console (DNS page, “Enable HTTPS”).', 'Active HTTPS pour ton tailnet dans la console d’administration Tailscale (page DNS, « Enable HTTPS »).') }}</b>
            <a class="phone-link" href="https://login.tailscale.com/admin/dns" target="_blank" rel="noopener noreferrer">login.tailscale.com/admin/dns <UIcon name="i-lucide-external-link" /></a>
          </li>
        </ol>
        <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="checking" @click="checkAgain">{{ tl('Check again', 'Vérifier à nouveau') }}</UButton>
        <p v-if="shown" :key="`r${flash}`" class="phone-result" :class="shown.state" role="status">
          <UIcon :name="RESULT_ICONS[shown.state]" /><span>{{ shown.text }}</span><time>{{ resultWhen }}</time>
        </p>
      </div>

      <div v-if="failure" class="phone-note warn" role="alert">
        <p v-if="!result">{{ failureText }}</p>
        <pre v-if="failure.error === 'failed' && failure.detail" class="phone-detail">{{ failure.detail }}</pre>
        <a v-if="failure.link" class="phone-link" :href="failure.link" target="_blank" rel="noopener noreferrer">{{ failure.link.replace(/^https:\/\//, '') }} <UIcon name="i-lucide-external-link" /></a>
      </div>

      <div v-if="status.reach === 'ok' && status.qr && status.url" class="phone-qr">
        <svg :viewBox="`0 0 ${status.qr.size} ${status.qr.size}`" role="img" :aria-label="tl('QR code of ', 'QR code de ') + status.url" shape-rendering="crispEdges">
          <rect width="100%" height="100%" fill="#fff" />
          <path :d="status.qr.path" fill="#000" />
        </svg>
        <div class="phone-qr-text">
          <p class="phone-url">{{ status.url }}</p>
          <p>{{ tl('1. Scan it with the iPhone camera, open it, then Share → Add to Home Screen.', '1. Scanne-le avec l’appareil photo de l’iPhone, ouvre-le, puis Partager → Sur l’écran d’accueil.') }}</p>
          <p>{{ tl('2. In the app from the Home Screen: Settings → Enable notifications, then Security → Enable passkey lock.', '2. Dans l’app ouverte depuis l’écran d’accueil : Réglages → Activer les notifications, puis Sécurité → Activer le verrou passkey.') }}</p>
        </div>
      </div>
    </template>
  </div>
</template>
