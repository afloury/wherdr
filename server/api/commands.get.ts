// "/" commands of a pane's agent (built-in + the machine's skills and
// commands), for the input field suggestions.
export default defineApi(async (event) => {
  const p = findPane(String(getQuery(event).pane || ''))
  if (!p) throw new HerdrError('bad_pane', 'Pane not found')
  const m = machineOfPane(p.id)
  if (!p.agent || !m || !m.home) return { commands: [] }
  // Remote machine unreachable: built-in commands only (no cache).
  if (!m.local && m.status !== 'online') return { commands: builtinCommands(p.agent) }
  return { commands: await slashCommands({ key: m.key, fs: m.fs, home: m.home, kind: p.agent, cwd: p.cwd }) }
})
