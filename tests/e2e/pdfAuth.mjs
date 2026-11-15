// Synthetic signing material for the isolated e2e servers only. The generation
// is a stored nonce (server/utils/auth.ts): a number would be replaced at startup.
import crypto from 'node:crypto'
export const pdfAuthDb = { secret: 'pdf-preview-test-only', generation: 'pdf-preview-test-generation', credentials: [{ id: 'test-key', publicKey: '', counter: 0, transports: [], name: 'Test device', createdAt: '2026-01-01' }] }
export function pdfSession() {
  const since = Date.now()
  const payload = `${since + 86400000}.${pdfAuthDb.generation}.${since}`
  return `${payload}.${crypto.createHmac('sha256', pdfAuthDb.secret).update(payload).digest('base64url')}`
}
