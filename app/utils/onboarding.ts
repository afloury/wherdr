// Phone address helpers: is this page on a loopback host, and the tailnet
// address to continue on (passkeys are tied to the address they are made on).

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '::1' || /^127\./.test(h)
}

// The page is open on localhost while wherdr's phone address (tailnet) is
// published and answers: that address, to continue there. Passkeys are tied
// to the address they are created on, so the lock is set up on the phone's.
export function tailnetSwitch(host: string, phone: { url: string | null, reach: string | null } | null): { url: string, name: string } | null {
  if (!phone?.url || phone.reach !== 'ok' || !isLoopbackHost(host)) return null
  try { return { url: phone.url, name: new URL(phone.url).hostname } } catch { return null }
}

// A settings section on another address.
export const onAddress = (url: string, hash: string) => `${new URL('/', url)}${hash}`
