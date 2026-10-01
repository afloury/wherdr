// Commandes « / » de l'agent d'un pane (intégrées + skills et commandes de la
// machine), pour les suggestions du champ de saisie.
export default defineApi(async (event) => {
  const p = findPane(String(getQuery(event).pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  const m = machineOfPane(p.id)
  if (!p.agent || !m || !m.home) return { commands: [] }
  // Machine distante injoignable : commandes intégrées seules (pas de cache).
  if (!m.local && m.status !== 'online') return { commands: builtinCommands(p.agent) }
  return { commands: await slashCommands({ key: m.key, fs: m.fs, home: m.home, kind: p.agent, cwd: p.cwd }) }
})
