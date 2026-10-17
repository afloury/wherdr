// Synthetic signing material for the isolated PDF e2e server only.
import crypto from 'node:crypto'
export const pdfAuthDb = { secret: 'pdf-preview-test-only', generation: 0, credentials: [{ id: 'test-key', publicKey: '', counter: 0, transports: [], name: 'Test device', createdAt: '2026-01-01' }] }
export function pdfSession() {
  const since = Date.now()
  const payload = `${since + 86400000}.0.${since}`
  return `${payload}.${crypto.createHmac('sha256', pdfAuthDb.secret).update(payload).digest('base64url')}`
}
