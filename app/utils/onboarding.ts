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
