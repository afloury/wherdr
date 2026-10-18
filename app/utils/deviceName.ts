import { isIOS } from './format'
import { t } from './i18n'

// Readable device name, for the passkey list (Settings › Security and the
// first-passkey screen).
export function deviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (isIOS && !/iPhone/.test(ua))) return 'iPad'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Android/.test(ua)) return 'Android'
  return t('Device')
}
