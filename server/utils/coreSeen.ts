// Rename and read / unread of a terminal on herdr-core. Both are labels, shared with the
// other herdr-core clients (herdr-app's contract): `herdr.title` holds the name somebody
// chose, `herdr.seen` the last finished turn somebody looked at (shared/coreInventory.ts).
import { HerdrError } from './herdr'
import { failure, type CoreInputDeps } from './coreInput'
import { TITLE_LABEL, SEEN_LABEL, seenUpdate, type CoreTerminal } from '../../shared/coreInventory'

function target(deps: CoreInputDeps, id: unknown) {
  const p = typeof id === 'string' ? deps.pane(id) : undefined
  if (!p?.coreAddress) throw new HerdrError('bad_pane', 'Pane not found')
  return p
}

// An empty name removes the label: the automatic name comes back.
export async function coreRename(deps: CoreInputDeps, b: { pane_id?: unknown, label?: unknown }) {
  const p = target(deps, b.pane_id)
  const label = String(b.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  try {
    await deps.call('terminal.label', { terminal: p.coreAddress, labels: { [TITLE_LABEL]: label } }, 8000)
    return { ok: true, label: label || null }
  } catch (e) { failure(e) } finally { deps.refresh() }
}

// Read: `herdr.seen` goes up to the current turn, never down. Unread: one turn behind.
export async function coreSeen(deps: CoreInputDeps, b: { pane_id?: unknown, read?: unknown }) {
  const p = target(deps, b.pane_id)
  const read = b.read !== false
  try {
    const t = await deps.call<CoreTerminal>('terminal.get', { terminal: p.coreAddress }, 8000)
    const value = seenUpdate(t, read)
    if (value !== null) await deps.call('terminal.label', { terminal: p.coreAddress, labels: { [SEEN_LABEL]: value } }, 8000)
    return { ok: true, changed: value !== null }
  } catch (e) { failure(e) } finally { deps.refresh() }
}
