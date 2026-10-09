<script setup lang="ts">
// First-launch setup guide: a centered modal over the blurred app on a
// computer, a full-screen page on a phone. Welcome (what wherdr is, the Herdr
// agents found), the phone (Tailscale, PhoneSetup.vue) or Add to Home Screen
// on a phone already on the tailnet address, then passkey lock and
// notifications. On localhost, once the tailnet address answers, a button
// continues at the same step on that address. Skip is always there; finishing or skipping is saved by the
// server (useOnboarding.ts).
import { type OnboardingStep, mobileOs, onAddress, onboardingSteps, setupHash, stepIndex } from '~/utils/onboarding'

const os = import.meta.client ? mobileOs(navigator.userAgent, isIOS && !/iPhone|iPad|iPod/.test(navigator.userAgent)) : null
const steps = computed(() => onboardingSteps({
  phone: Boolean(os) || !desk.value,
  host: import.meta.client ? location.hostname : 'localhost',
  standalone: Boolean(standalone),
}))
const index = ref(0)
watch(onboardingStep, (s) => { if (s) index.value = stepIndex(steps.value, s) }, { immediate: true })
const step = computed<OnboardingStep>(() => steps.value[Math.min(index.value, steps.value.length - 1)]!)
const last = computed(() => index.value >= steps.value.length - 1)
const body = ref<HTMLElement | null>(null)
watch(index, () => nextTick(() => { if (body.value) body.value.scrollTop = 0 }))

const STEP_LABELS: Record<OnboardingStep, [string, string]> = {
  welcome: ['Welcome', 'Bienvenue'],
  phone: ['Phone', 'Téléphone'],
  homescreen: ['Home Screen', 'Écran d’accueil'],
  security: ['Security', 'Sécurité'],
}
const label = (s: OnboardingStep) => tl(...STEP_LABELS[s])
const counter = computed(() => `${String(index.value + 1).padStart(2, '0')} / ${String(steps.value.length).padStart(2, '0')}`)

function next() { if (last.value) finishOnboarding(); else index.value++ }
function prev() { if (index.value > 0) index.value-- }
function skip() { finishOnboarding() }

// Welcome: Herdr on this machine and the agents it runs.
const herdrOk = computed(() => herdrState.value.ok)
const herdrVersion = computed(() => herdrState.value.version || '')
const localAgents = computed(() => herdrState.value.panes.filter(p => !p.machine && p.agent))
const agentKinds = computed(() => [...new Set(localAgents.value.map(p => p.agent!))])
const agentsText = computed(() => {
  const n = localAgents.value.length
  return n === 1
    ? tl('1 agent found on this machine', '1 agent trouvé sur cette machine')
    : tl(`${n} agents found on this machine`, `${n} agents trouvés sur cette machine`)
})
function newAgent() { newAgentOpen.value = true }

// Security: the lock and the notifications, as in Settings.
onMounted(() => {
  refreshAuthStatus()
  refreshPushOn()
  refreshPhoneAddress()
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !anySheetOpen.value) skip()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="onboarding">
  <div class="onboarding-panel" role="dialog" aria-modal="true" :aria-label="tl('Setup guide', 'Guide de démarrage')">
    <header class="onboarding-top">
      <div class="onboarding-brand">
        <img :src="'/icons/icon-192.png?v=5'" alt="" class="onboarding-logo">
        <span>wherdr · {{ tl('Setup', 'Configuration') }}</span>
      </div>
      <UButton color="neutral" variant="ghost" size="md" class="onboarding-skip" @click="skip">{{ tl('Skip', 'Passer') }}</UButton>
    </header>

    <nav class="onboarding-steps" :aria-label="tl('Steps', 'Étapes')">
      <span class="onboarding-count">{{ counter }}</span>
      <ol>
        <li v-for="(s, i) in steps" :key="s" :class="{ current: i === index, done: i < index }" :aria-current="i === index ? 'step' : undefined">
          <button type="button" @click="index = i"><i /><span>{{ label(s) }}</span></button>
        </li>
      </ol>
    </nav>

    <a v-if="tailnet && step !== 'security'" class="onboarding-tailnet" :href="onAddress(tailnet.url, setupHash(step))">
      <span class="onboarding-tailnet-label">{{ tl('Published on your tailnet', 'Publié sur ton tailnet') }}</span>
      <span class="onboarding-tailnet-go"><span>{{ tl('Continue on', 'Continuer sur') }} <b>{{ tailnet.name }}</b></span><UIcon name="i-lucide-arrow-right" /></span>
    </a>

    <div ref="body" class="onboarding-body">
      <div class="onboarding-page">
        <!-- Welcome -->
        <template v-if="step === 'welcome'">
          <p class="eyebrow onboarding-eyebrow">{{ tl('Welcome', 'Bienvenue') }}</p>
          <h2 class="onboarding-title">{{ tl('Your Herdr agents, wherever you are.', 'Tes agents Herdr, où que tu sois.') }}</h2>
          <p class="onboarding-lead">{{ tl('wherdr shows the code agents running in Herdr live: their conversations, real terminals and one-tap answers, in this browser and on your phone.', 'wherdr affiche en direct les agents de code qui tournent dans Herdr : leurs conversations, de vrais terminaux et des réponses en un geste, dans ce navigateur et sur ton téléphone.') }}</p>
          <ol class="phone-steps onboarding-facts">
            <li :class="{ done: herdrOk, bad: !herdrOk }">
              <span class="phone-step-label">HERDR</span>
              <p v-if="herdrOk">{{ herdrVersion ? tl(`Herdr ${herdrVersion} is running.`, `Herdr ${herdrVersion} tourne.`) : tl('Herdr is running.', 'Herdr tourne.') }}</p>
              <p v-else>{{ tl('Herdr does not answer yet. Start it in a terminal:', 'Herdr ne répond pas encore. Lance-le dans un terminal :') }} <code>herdr</code></p>
            </li>
            <li :class="{ done: localAgents.length > 0 }">
              <span class="phone-step-label">{{ tl('AGENTS', 'AGENTS') }}</span>
              <template v-if="localAgents.length">
                <p>{{ agentsText }}</p>
                <span class="onboarding-kinds"><span v-for="k in agentKinds" :key="k" class="onboarding-kind"><AgentAvatar :agent="k" />{{ k }}</span></span>
              </template>
              <template v-else>
                <p>{{ tl('No agent yet. Start one in a Herdr pane (claude, codex, omp…), or from here:', 'Aucun agent pour l’instant. Lances-en un dans un pane Herdr (claude, codex, omp…), ou d’ici :') }}</p>
                <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!herdrOk" @click="newAgent">{{ tl('Start an agent', 'Lancer un agent') }}</UButton>
              </template>
            </li>
          </ol>
        </template>

        <!-- Phone: Tailscale -->
        <template v-else-if="step === 'phone'">
          <p class="eyebrow onboarding-eyebrow">{{ tl('On your phone', 'Sur ton téléphone') }}</p>
          <h2 class="onboarding-title">{{ tl('Reach your agents from your phone.', 'Retrouve tes agents sur ton téléphone.') }}</h2>
          <PhoneSetup :active="step === 'phone'" />
        </template>

        <!-- Phone already on the tailnet address: Add to Home Screen -->
        <template v-else-if="step === 'homescreen'">
          <p class="eyebrow onboarding-eyebrow">{{ tl('Home Screen', 'Écran d’accueil') }}</p>
          <h2 class="onboarding-title">{{ tl('Install wherdr as an app.', 'Installe wherdr comme une app.') }}</h2>
          <p class="onboarding-lead">{{ tl('Your phone already reaches wherdr through Tailscale. Add it to your Home Screen: it opens full screen, and notifications need it on iPhone.', 'Ton téléphone joint déjà wherdr par Tailscale. Ajoute-le à ton écran d’accueil : il s’ouvre en plein écran, et l’iPhone l’exige pour les notifications.') }}</p>
          <div class="onboarding-install">
            <section v-if="os !== 'android'" class="settings-card onboarding-howto">
              <h3>iPhone · iPad</h3>
              <ol>
                <li>{{ tl('Open this page in Safari.', 'Ouvre cette page dans Safari.') }}</li>
                <li>{{ tl('Tap Share', 'Touche Partager') }} <UIcon name="i-lucide-share" /></li>
                <li>{{ tl('Tap Add to Home Screen, then Add.', 'Touche Sur l’écran d’accueil, puis Ajouter.') }}</li>
                <li>{{ tl('Open wherdr from its icon, then come back here.', 'Ouvre wherdr depuis son icône, puis reviens ici.') }}</li>
              </ol>
            </section>
            <section v-if="os !== 'ios'" class="settings-card onboarding-howto">
              <h3>Android</h3>
              <ol>
                <li>{{ tl('Open the browser menu', 'Ouvre le menu du navigateur') }} <UIcon name="i-lucide-ellipsis-vertical" /></li>
                <li>{{ tl('Tap Install app (or Add to Home screen).', 'Touche Installer l’application (ou Ajouter à l’écran d’accueil).') }}</li>
                <li>{{ tl('Open wherdr from its icon, then come back here.', 'Ouvre wherdr depuis son icône, puis reviens ici.') }}</li>
              </ol>
            </section>
          </div>
        </template>

        <!-- Security and notifications -->
        <template v-else>
          <p class="eyebrow onboarding-eyebrow">{{ tl('Security and notifications', 'Sécurité et notifications') }}</p>
          <h2 class="onboarding-title">{{ tl('Lock it, and get notified.', 'Verrouille-le, et sois prévenu.') }}</h2>
          <div class="settings-group">
            <h3>{{ tl('Passkey lock · recommended', 'Verrou passkey · recommandé') }}</h3>
            <p class="onboarding-why">{{ tl('Only your devices can open wherdr, with Face ID, Touch ID or Windows Hello: no password to leak.', 'Seuls tes appareils ouvrent wherdr, avec Face ID, Touch ID ou Windows Hello : aucun mot de passe à fuiter.') }}</p>
            <PasskeyCard :continue-hash="setupHash('security')" />
          </div>
          <div class="settings-group">
            <h3>{{ tl('Notifications', 'Notifications') }}</h3>
            <p class="onboarding-why">{{ tl('Know when an agent needs your answer or finishes, even with the app closed.', 'Sache quand un agent attend ta réponse ou a fini, même app fermée.') }}</p>
            <PushCard />
          </div>
          <p class="muted onboarding-later">{{ tl('Everything here stays in Settings. This guide too: Settings › About › Setup guide.', 'Tout reste dans les Réglages. Ce guide aussi : Réglages › À propos › Guide de démarrage.') }}</p>
        </template>
      </div>
    </div>

    <footer class="onboarding-foot">
      <UButton color="neutral" variant="outline" size="lg" icon="i-lucide-arrow-left" :disabled="index === 0" :aria-label="tl('Back', 'Retour')" @click="prev" />
      <UButton class="hw-cta onboarding-next" color="primary" size="lg" :trailing-icon="last ? 'i-lucide-check' : 'i-lucide-arrow-right'" @click="next">
        {{ last ? tl('Finish', 'Terminer') : tl('Next', 'Suivant') }}
      </UButton>
    </footer>
  </div>
  </div>
</template>
