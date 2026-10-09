// QR code as one SVG path: 1 unit per module, quiet zone of 2. Drawn by the
// server for the phone address it checked, and by the app for the address the
// page is open on (PhoneSetup.vue).
import QRCode from 'qrcode-terminal/vendor/QRCode/index.js'
import QRErrorCorrectLevel from 'qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js'

export function qrSvg(text: string): { size: number, path: string } {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M)
  qr.addData(text)
  qr.make()
  const n: number = qr.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) if (qr.isDark(r, col)) d += `M${col + 2} ${r + 2}h1v1h-1z`
  }
  return { size: n + 4, path: d }
}
