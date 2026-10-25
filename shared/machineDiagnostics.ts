export interface MachineDiagnostic {
  supported: boolean
  status: 'reachable' | 'auth required' | 'error' | 'disabled' | null
  error: string | null
  reconnect: string | null
}

// A failed connectivity check still returns JSON (and exits 1).
export function parseMachineDiagnostic(raw: string, id: string): MachineDiagnostic | null {
  try {
    const rows: unknown = JSON.parse(raw)
    if (!Array.isArray(rows)) return null
    const row = rows.find(x => x && x.id === id)
    if (!row || !['reachable', 'auth required', 'error', 'disabled'].includes(row.status)) return null
    return { supported: true, status: row.status, error: typeof row.error === 'string' ? row.error : null,
      reconnect: `herdr machine reconnect '${id.replace(/'/g, "'\\''")}'` }
  } catch { return null }
}
