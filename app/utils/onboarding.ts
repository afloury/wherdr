// Steps of the first-launch setup guide (OnboardingGuide.vue).
// On a computer, or a phone on this machine's own address: welcome, phone
// setup (Tailscale), security. A phone that already came through the tailnet
// address has done the phone step: it gets Add to Home Screen instead
// (skipped once the app runs from the Home Screen).

export type OnboardingStep = 'welcome' | 'phone' | 'homescreen' | 'security'
export type MobileOs = 'ios' | 'android' | null

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '::1' || /^127\./.test(h)
}

export function mobileOs(userAgent: string, touchMac = false): MobileOs {
  if (/iPhone|iPad|iPod/.test(userAgent) || touchMac) return 'ios'
  if (/Android/.test(userAgent)) return 'android'
  return null
}

export function onboardingSteps(o: { phone: boolean, host: string, standalone: boolean }): OnboardingStep[] {
  if (o.phone && !isLoopbackHost(o.host)) return o.standalone ? ['welcome', 'security'] : ['welcome', 'homescreen', 'security']
  return ['welcome', 'phone', 'security']
}

// The page is open on localhost while wherdr's phone address (tailnet) is
// published and answers: that address, to continue there. Passkeys are tied
// to the address they are created on, so the lock is set up on the phone's.
export function tailnetSwitch(host: string, phone: { url: string | null, reach: string | null } | null): { url: string, name: string } | null {
  if (!phone?.url || phone.reach !== 'ok' || !isLoopbackHost(host)) return null
  try { return { url: phone.url, name: new URL(phone.url).hostname } } catch { return null }
}

// The same guide step (#/setup?step=…) or settings section, on another address.
export const setupHash = (step: OnboardingStep) => `#/setup?step=${step}`
export const onAddress = (url: string, hash: string) => `${new URL('/', url)}${hash}`

// #/setup?step=…: the step to open the guide at (the first one when unknown).
export function stepIndex(steps: OnboardingStep[], step: unknown): number {
  return Math.max(0, steps.indexOf(String(Array.isArray(step) ? step[0] : step) as OnboardingStep))
}
