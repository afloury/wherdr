// Install section: the method recommended for the visitor's system, read from
// the user agent in the browser (the page itself is prerendered). Mobile
// systems and Windows get no recommendation: wherdr installs on the computer
// that runs Herdr (Linux or macOS).

export type InstallOs = 'mac' | 'linux'

export function installOs(userAgent: string, maxTouchPoints = 0): InstallOs | null {
  if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return null
  // iPadOS asks for the desktop site: a "Macintosh" with a touch screen.
  if (/Macintosh|Mac OS X/.test(userAgent)) return maxTouchPoints > 1 ? null : 'mac'
  if (/Linux|X11|CrOS/.test(userAgent)) return 'linux'
  return null
}
