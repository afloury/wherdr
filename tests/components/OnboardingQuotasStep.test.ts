// WHR-48: the setup guide's optional Quotas step is added before Security when
// /api/quotas says a machine needs it. Quotas that arrive after the mount must
// not move the user off the step they are on (a #/setup?step=security link).
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import OnboardingGuide from '~/components/OnboardingGuide.vue'
import { homeQuotas } from '~/composables/useHerdr'
import { onboardingStep } from '~/composables/useOnboarding'
import type { Quotas } from '#shared/types'

const missing: Quotas = { claude: null, codex: null, claudeSetup: [{ key: '', state: 'missing', installable: true }] }
let served: Quotas | null = null
registerEndpoint('/api/quotas', () => served ?? { claude: null, codex: null })
registerEndpoint('/api/phone', () => ({ url: null, reach: null }))

const current = (w: { find: (s: string) => { text: () => string } }) => w.find('.onboarding-steps li.current').text()
const counter = (w: { find: (s: string) => { text: () => string } }) => w.find('.onboarding-count').text()

describe('setup guide: quotas arriving late', () => {
  afterEach(() => { homeQuotas.value = null; onboardingStep.value = null; served = null })

  it('keeps the user on Security when the Quotas step is added before it', async () => {
    onboardingStep.value = 'security'
    const w = await mountSuspended(OnboardingGuide)
    await new Promise(r => setTimeout(r, 0))
    expect(current(w)).toMatch(/Security|Sécurité/)
    const before = counter(w)
    homeQuotas.value = missing
    await nextTick()
    await nextTick()
    expect(w.findAll('.onboarding-steps li').map(l => l.text()).some(t => /Quotas/.test(t))).toBe(true)
    expect(current(w)).toMatch(/Security|Sécurité/)
    // One step more, and Security moved one place further.
    expect(counter(w)).not.toBe(before)
    // Not left through the Quotas step: nothing was declined.
    expect(homeQuotas.value?.claudeSetup?.[0]?.dismissed).toBeUndefined()
    w.unmount()
  })

  it('a direct link to the Quotas step lands on it once the quotas are known', async () => {
    served = missing
    homeQuotas.value = missing
    onboardingStep.value = 'quotas'
    const w = await mountSuspended(OnboardingGuide)
    await nextTick()
    expect(current(w)).toMatch(/Quotas/)
    w.unmount()
  })
})
