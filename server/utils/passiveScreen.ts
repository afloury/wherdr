// Status checks must not harvest application-owned history: Herdr may do
// that by scrolling an idle alternate-screen agent and restoring it later.
export async function readPassiveScreen(
  call: (method: string, params: Record<string, unknown>, timeoutMs: number) => Promise<{ read?: { text?: unknown } }>,
  paneId: string,
): Promise<string> {
  const r = await call('pane.read', { pane_id: paneId, source: 'visible' }, 4000)
  return String(r?.read?.text || '')
}
