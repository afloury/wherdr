// The QR encoder bundled with qrcode-terminal (no types of its own).
declare module 'qrcode-terminal/vendor/QRCode/index.js' {
  export default class QRCode {
    constructor(typeNumber: number, errorCorrectLevel: number)
    addData(data: string): void
    make(): void
    getModuleCount(): number
    isDark(row: number, col: number): boolean
  }
}
declare module 'qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js' {
  const level: { L: number, M: number, Q: number, H: number }
  export default level
}
